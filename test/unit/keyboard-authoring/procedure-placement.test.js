import {findProcedurePosition} from '../../../src/experiments/keyboard-authoring/procedure-placement';

const rect = (x,y,width,height) => ({topLeft:{x,y},bottomRight:{x:x+width,y:y+height}});
const overlaps = (point,size,block) => point.x < block.bottomRight.x && point.x+size.width > block.topLeft.x &&
    point.y < block.bottomRight.y && point.y+size.height > block.topLeft.y;

test('places a definition beside a long script without moving its source', () => {
    const anchor = rect(100,200,180,800);
    expect(findProcedurePosition(anchor,[anchor],{width:200,height:100}))
        .toEqual({kind:'workspace',x:344,y:200});
    expect(anchor).toEqual(rect(100,200,180,800));
});

test('chooses the nearer below-script position when the neighbouring column is occupied', () => {
    const anchor = rect(100,200,180,100);
    expect(findProcedurePosition(anchor,[anchor,rect(364,200,500,900)],{width:200,height:100}))
        .toEqual({kind:'workspace',x:100,y:364});
});

test('handles overlapping obstacles and wide definitions deterministically without collisions', () => {
    const anchor = rect(100,200,180,100);
    const occupied = [anchor,rect(344,200,500,900),rect(50,360,160,400),rect(0,500,900,1000)];
    const size = {width:750,height:140};
    const result = findProcedurePosition(anchor,occupied,size);
    expect(occupied.some(block => overlaps(result,size,block))).toBe(false);
    expect(findProcedurePosition(anchor,[...occupied].reverse(),size)).toEqual(result);
});

test('mirrors placement for RTL in native workspace coordinates, including negative positions', () => {
    const anchor = rect(-280,200,180,800);
    expect(findProcedurePosition(anchor,[anchor],{width:200,height:100},true))
        .toEqual({kind:'workspace',x:-344,y:200});
});
