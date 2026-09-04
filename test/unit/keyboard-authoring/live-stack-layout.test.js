import {planStackSpacing, planProspectiveStackSpacing, captureStackBounds, attachLiveStackLayout, LIVE_STACK_LAYOUT,
    needsStackSpacing}
    from '../../../src/experiments/keyboard-authoring/live-stack-layout';
import {inEventGroup} from '../../../src/experiments/keyboard-authoring/operations';

const row = (id,x,y,height=100,reporter=false,width=100) => ({id,x,y,height,width,reporter});

test('growing a stack cascades down its column and leaves other columns alone', () => {
    const blocks = [row('a',0,0,200),row('b',0,150),row('c',0,300),row('other',300,150)];
    expect(planStackSpacing(blocks,'a')).toEqual([{id:'b',dx:0,dy:100},{id:'c',dx:0,dy:100}]);
    expect(blocks[1].y).toBe(150);
});

test('prefers the aligned stack above, even when the one below is closer', () => {
    expect(planStackSpacing([row('above',10,0),row('active',0,200),row('below',20,300)],'active'))
        .toEqual([{id:'active',dx:10,dy:0},{id:'below',dx:0,dy:50}]);
});

test('still cascades lower stacks after the active root is pushed past their old position', () => {
    expect(planStackSpacing([row('above',0,0,300),row('active',0,100),row('below',0,250)],'active'))
        .toEqual([{id:'active',dx:0,dy:250},{id:'below',dx:0,dy:250}]);
});

test('loose neighbours and floating reporters follow the last column shift without advancing its floor', () => {
    expect(planStackSpacing([row('a',0,0,200),row('b',0,150),row('loose',70,270),
        row('reporter',20,280,40,true),row('c',0,300)],'a')).toEqual([
        {id:'b',dx:0,dy:100},{id:'loose',dx:0,dy:100},{id:'reporter',dx:0,dy:100},{id:'c',dx:0,dy:100}]);
});

test('a partly overlapping offset stack establishes a cascade when no aligned stack has moved yet', () => {
    expect(planStackSpacing([row('draft',35,100,120),row('offset',0,180),row('lower',0,330)],'draft'))
        .toEqual([{id:'offset',dx:0,dy:90},{id:'lower',dx:0,dy:90}]);
});

test('floating reporters do not initiate tidy-up or attract stack alignment', () => {
    const blocks=[row('r',20,0,40,true),row('a',0,90)];
    expect(planStackSpacing(blocks,'r')).toEqual([]);
    expect(planStackSpacing(blocks,'a')).toEqual([]);
});

test('sufficient gaps are retained and a zero setting remains meaningful', () => {
    expect(planStackSpacing([row('a',0,0),row('b',0,1000)],'a')).toEqual([]);
    expect(planStackSpacing([row('a',0,0),row('b',0,100)],'a',0)).toEqual([]);
});

test('width growth pushes whole right columns, cascades once and preserves their vertical positions', () => {
    const blocks = [row('active',0,0,150,false,420), row('below',0,180),
        row('right',300,-100), row('rightBelow',310,500), row('loose',320,700,30,true),
        row('third',500,40), row('distant',1000,0), row('left',-300,0)];
    const original = JSON.stringify(blocks);
    expect(planStackSpacing(blocks, 'active')).toEqual([
        {id:'below',dx:0,dy:20}, {id:'right',dx:184,dy:0},
        {id:'rightBelow',dx:184,dy:0}, {id:'loose',dx:184,dy:0}, {id:'third',dx:158,dy:0}
    ]);
    expect(JSON.stringify(blocks)).toBe(original);
});

test('an overlapping separate column moves right, never down even at the same height', () => {
    expect(planStackSpacing([row('active',0,0,100,false,350),row('right',250,0)],'active'))
        .toEqual([{id:'right',dx:164,dy:0}]);
});

test('column spacing stops at spare room without tidying unrelated later overlaps', () => {
    expect(planStackSpacing([row('active',0,0),row('right',300,0,100,false,500),row('later',500,0)],'active'))
        .toEqual([]);
});

test('column membership is deterministic, anchored rather than transitive, and independent of draft width', () => {
    const blocks = [row('active',0,0,100,false,330),row('offset',100,400),row('right',200,0)];
    const moves = planStackSpacing(blocks,'active');
    expect(moves).toEqual([{id:'right',dx:194,dy:0}]);
    expect(planStackSpacing([...blocks].reverse(),'active')).toEqual(moves);
});

test('width-only drafts keep columns stationary until the edit is accepted', () => {
    const blocks = [row('active',0,0),row('right',300,0),row('third',500,200)];
    const enlarged = row('active',0,0,100,false,400);
    expect(planProspectiveStackSpacing(blocks,enlarged)).toEqual([]);
    expect(planStackSpacing([enlarged,...blocks.slice(1)],'active')).toEqual([
        {id:'right',dx:164,dy:0},{id:'third',dx:128,dy:0}
    ]);
    expect(planProspectiveStackSpacing(blocks,blocks[0])).toEqual([]);
    expect(blocks[1].x).toBe(300);
});

test('new-script reservations leave neighbouring columns still until acceptance', () => {
    const blocks = [row('right',180,0),row('lower',180,400)];
    expect(planProspectiveStackSpacing(blocks,row('draft',0,0,48,false,144)))
        .toEqual([]);
    expect(blocks[0].x).toBe(180);
});

test('floating reporters neither initiate horizontal tidy nor expand a column footprint', () => {
    const blocks = [row('active',0,0),row('loose',20,200,50,true,900),row('right',300,0)];
    expect(planStackSpacing(blocks,'active')).toEqual([]);
    expect(planStackSpacing(blocks,'loose')).toEqual([]);
});

test('explicit zero column gap allows adjacent column footprints', () => {
    expect(planStackSpacing([row('active',0,0,100,false,200),row('right',200,0)],'active',0,0)).toEqual([]);
});

test('reapplying the result is stable even when following columns have very narrow blocks', () => {
    const blocks = [row('active',0,0,100,false,400),row('slim',300,0,100,false,24),
        row('next',500,0,100,false,24)];
    const moves = new Map(planStackSpacing(blocks,'active').map(move=>[move.id,move]));
    const applied = blocks.map(block=>({...block,x:block.x+(moves.get(block.id)?.dx||0),
        y:block.y+(moves.get(block.id)?.dy||0)}));
    expect(applied[2].x-applied[1].x).toBeGreaterThanOrEqual(128);
    expect(planStackSpacing(applied,'active')).toEqual([]);
});

test('preview and commit only reflow new or enlarged statement roots, not unchanged or smaller fields', () => {
    const previous = row('a',0,0);
    expect(needsStackSpacing(previous,{...previous,width:101})).toBe(true);
    expect(needsStackSpacing(previous,{...previous,height:101})).toBe(true);
    expect(needsStackSpacing(previous,{...previous,width:80})).toBe(false);
    expect(needsStackSpacing(previous,{...previous})).toBe(false);
    expect(needsStackSpacing(null,previous)).toBe(true);
    expect(needsStackSpacing(null,{...previous,reporter:true})).toBe(false);
});

test('prospective growth uses the rendered draft dimensions without mutating the source snapshot', () => {
    const blocks = [row('active',0,0,100),row('below',0,150)];
    expect(planProspectiveStackSpacing(blocks,row('active',0,0,220))).toEqual([
        {id:'below',dx:0,dy:120}
    ]);
    expect(blocks).toEqual([row('active',0,0,100),row('below',0,150)]);
});

test('a prospective detached stack reserves a complete new column position', () => {
    const blocks = [row('above',20,0),row('below',20,180)];
    expect(planProspectiveStackSpacing(blocks,row('draft',0,100,120))).toEqual([
        {id:'below',dx:0,dy:140},{id:'draft',dx:20,dy:50}
    ]);
});

test('prospective reporters and non-colliding commands do not displace stacks', () => {
    const blocks = [row('other',300,0)];
    expect(planProspectiveStackSpacing(blocks,row('draft',0,0,40,true))).toEqual([]);
    expect(planProspectiveStackSpacing(blocks,row('draft',0,0))).toEqual([]);
});

test('uses physical native rectangles when reflecting RTL, not origin plus guessed width', () => {
    expect(captureStackBounds({RTL:true,getTopBlocks:()=>[{
        id:'a',getBoundingRectangle:()=>({topLeft:{x:-300,y:20},bottomRight:{x:-100,y:120}})
    }]})).toEqual([row('a',100,20,100,false,200)]);
});

const fixture = () => {
    let group='previous';
    const blocks = [row('a',0,0),row('b',0,150)];
    const native = new Map(blocks.map(block=>[block.id,{
        id:block.id,getRootBlock(){return this;},
        getBoundingRectangle:()=>({topLeft:{x:block.x,y:block.y},
            bottomRight:{x:block.x+block.width,y:block.y+block.height}}),
        moveBy:jest.fn((dx,dy)=>{block.x+=dx;block.y+=dy;})
    }]));
    const ws={options:{},isDragging:()=>false,getTopBlocks:()=>[...native.values()],getBlockById:id=>native.get(id),
        undoStack_:[],setBlockSpacingHandler:jest.fn(handler=>{ws.handler=handler;}),
        applyBlockSpacing:(block,source)=>ws.handler(block,source)};
    const ScratchBlocks={Events:{isEnabled:()=>true,recordUndo:true,getGroup:()=>group,setGroup:value=>{group=value;}}};
    const layout=attachLiveStackLayout({workspace:ws,ScratchBlocks,available:()=>true});
    return {blocks,native,ws,ScratchBlocks,layout};
};

test('spacing finishes inside the same native event group; failures do not lay anything out', () => {
    const f=fixture();
    const moves=f.native.get('b').moveBy;
    inEventGroup(f.ScratchBlocks,()=>{f.blocks[0].height=200;},()=>f.layout.beginEdit());
    expect(moves).toHaveBeenCalledWith(0,100);
    expect(f.ScratchBlocks.Events.getGroup()).toBe('previous');
    moves.mockClear();
    expect(()=>inEventGroup(f.ScratchBlocks,()=>{throw Error('invalid insert');},()=>f.layout.beginEdit())).toThrow();
    expect(moves).not.toHaveBeenCalled();
});

test('RTL horizontal growth moves the following column in the mirrored native direction', () => {
    const f=fixture(); f.ws.RTL=true;
    f.blocks[0].x=-100; f.blocks[1].x=-400;
    inEventGroup(f.ScratchBlocks,()=>{f.blocks[0].x=-400;f.blocks[0].width=400;},()=>f.layout.beginEdit());
    expect(f.native.get('b').moveBy).toHaveBeenCalledWith(-164,0);
    expect(f.blocks[1].y).toBe(150);
});

test.each(['readonly','undo','drag','disabled'])('does not tidy in %s context', mode => {
    const f=fixture();
    if(mode==='readonly') f.ws.options.readOnly=true;
    if(mode==='undo') f.ScratchBlocks.Events.recordUndo=false;
    if(mode==='drag') f.ws.isDragging=()=>true;
    if(mode==='disabled') LIVE_STACK_LAYOUT.enabled=false;
    try { expect(f.layout.beginEdit()).toBeNull(); }
    finally { LIVE_STACK_LAYOUT.enabled=true; }
});

test('a delayed native drop cannot resurrect an undone or superseded layout', () => {
    const f=fixture(); f.blocks[0].height=200;
    for(const stack of [[],[{group:'newer'}]]) {
        f.ws.undoStack_=stack;
        expect(f.ws.handler(f.native.get('a'),'drop')).toBe(true);
        expect(f.native.get('b').moveBy).not.toHaveBeenCalled();
    }
    f.ws.undoStack_=[{group:'previous'}];
    f.ws.handler(f.native.get('a'),'drop');
    expect(f.native.get('b').moveBy).toHaveBeenCalledWith(0,100);
    f.layout.detach(); expect(f.ws.setBlockSpacingHandler).toHaveBeenLastCalledWith(null);
});
