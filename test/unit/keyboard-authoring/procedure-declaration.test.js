import {JSDOM} from 'jsdom';
import {acceptsProcedureCall, createProcedureCompletion, parseProcedureDeclaration, procedureCallXml}
    from '../../../src/experiments/keyboard-authoring/procedure-declaration';

const {document, DOMParser} = new JSDOM('').window;

test('parses Scratch-shaped text, number and Boolean custom block arguments', () => {
    expect(parseProcedureDeclaration('define jump (height) if <ready?>')).toEqual({
        text: 'define jump (height) if <ready?>',
        procCode: 'jump %s if %b',
        argumentNames: ['height', 'ready?'],
        argumentTypes: ['string', 'boolean'],
        argumentDefaults: ['', 'false']
    });
});

test('normalizes whitespace and escapes literal percent labels', () => {
    expect(parseProcedureDeclaration('  define  set 100% speed   to (amount) ').procCode)
        .toBe('set 100\\% speed to %s');
});

test('accepts a localized native define keyword as well as the explicit English command', () => {
    expect(parseProcedureDeclaration('définir saute (hauteur)', ['définir', 'define']).procCode)
        .toBe('saute %s');
    expect(parseProcedureDeclaration('define jump', ['définir', 'define']).procCode).toBe('jump');
});

test.each([
    ['define', 'Type a custom block name'],
    ['define jump (height', 'Close the () argument'],
    ['define jump ()', 'needs a name'],
    ['define (height)', 'at least one text label'],
    ['define jump (height) (HEIGHT)', 'is repeated'],
    ['define jump >', 'Unexpected']
])('reports an actionable incomplete declaration for %s', (query, error) => {
    expect(parseProcedureDeclaration(query).error).toContain(error);
});

test('does not reinterpret ordinary Scratch block searches as declarations', () => {
    expect(parseProcedureDeclaration('say define jump')).toBeNull();
    expect(parseProcedureDeclaration('defined jump')).toBeNull();
});

test.each([
    ['define', '', []],
    ['define Test (', 'Test %s', ['']],
    ['define Test (th', 'Test %s', ['th']],
    ['define Test (thing) if <re', 'Test %s if %b', ['thing','re']],
    ['define Test ()', 'Test %s', ['']],
    ['define Test >', 'Test', []],
    ['define Test (value) (VALUE)', 'Test %s %s', ['value','VALUE']]
])('retains a presentation-only signature for incomplete input %s', (query, procCode, argumentNames) => {
    const result = parseProcedureDeclaration(query);
    expect(result.error).toBeTruthy();
    expect(result.procCode).toBeUndefined();
    expect(result.preview).toMatchObject({procCode,argumentNames});
});

test('localized incomplete declarations use the same bounded preview scan', () => {
    expect(parseProcedureDeclaration('définir Test (th',['définir']).preview)
        .toMatchObject({procCode:'Test %s',argumentNames:['th']});
    const tooMany = parseProcedureDeclaration(`define Test ${Array.from({length:13},(_,i)=>`(a${i})`).join(' ')}`);
    expect(tooMany.error).toContain('12 typed arguments');
    expect(tooMany.preview.argumentNames).toHaveLength(12);
    expect(parseProcedureDeclaration(`define ${'x'.repeat(161)}`).error).toContain('160 characters');
});

test.each(['define jump (height) :: warp','define jump (height) :: WARP'])(
    'recognizes the explicit screen-refresh modifier without adding it to the signature: %s', text => {
        expect(parseProcedureDeclaration(text)).toMatchObject({procCode:'jump %s',warp:true,argumentNames:['height']});
    });

test('screen-refresh words without the explicit suffix remain ordinary custom-block labels', () => {
    expect(parseProcedureDeclaration('define run without screen refresh')).toMatchObject({
        procCode:'run without screen refresh'});
    expect(parseProcedureDeclaration('define warp (speed)').warp).toBeUndefined();
    expect(parseProcedureDeclaration('define jump (height :: warp').preview).toMatchObject({procCode:'jump %s',warp:true});
});

test('normal and warp rows reach both native definition and call previews without allocating identities', () => {
    const f = completionFixture();
    for (const position of [{kind:'workspace'},{kind:'gap',blockId:'anchor'}]) {
        for (const query of ['define jump','define jump :: warp']) {
            const choices = f.completion.choices(position,query);
            expect(choices.map(choice=>choice.warp)).toEqual(query.endsWith('warp') ? [true,false] : [false,true]);
            for (const choice of choices) {
                expect(choice.procCode).toBe('jump');
                expect(choice.text).toBe(choice.warp ? 'define jump :: warp' : 'define jump');
                expect(choice.description).toContain(choice.warp ? 'Run without screen refresh' : 'With screen refresh');
                expect(f.completion.previewXml(choice).querySelector('mutation').getAttribute('warp'))
                    .toBe(String(choice.warp));
            }
        }
    }
    expect(f.ScratchBlocks.Xml.domToBlock).not.toHaveBeenCalled();
    expect(f.ScratchBlocks.utils.genUid).not.toHaveBeenCalled();
});

const completionFixture = () => {
    const blocks = new Map();
    const workspace = {getBlockById: id => blocks.get(id)};
    const ScratchBlocks = {Msg: {}, NEXT_STATEMENT: 3, PROCEDURES_CALL_TYPE_STATEMENT: 0,
        Procedures: {getDefineBlock: jest.fn(() => null), getProcedureReturnType: jest.fn(() => 0),
            newProcedureMutation: () => document.createElement('mutation')},
        Xml: {textToDom: text => new DOMParser().parseFromString(text, 'text/xml').documentElement,
            domToBlock: jest.fn()},
        utils: {genUid: jest.fn()}};
    const vm = {editingTarget: {id: 'sprite'}};
    const anchor = {previousConnection: {}, nextConnection: {type: 3},
        getInput: name => ({connection: {type: name === 'SUBSTACK' ? 3 : 1}})};
    blocks.set('anchor', anchor);
    return {blocks, workspace, ScratchBlocks, vm, anchor,
        completion: createProcedureCompletion({workspace, ScratchBlocks, vm})};
};

test.each([
    [{kind:'gap',blockId:'anchor'}, true],
    [{kind:'before',blockId:'anchor'}, true],
    [{kind:'gap',blockId:'anchor',inputName:'SUBSTACK'}, true],
    [{kind:'input',blockId:'anchor',inputName:'CONDITION'}, false],
    [{kind:'gap',blockId:'anchor',inputName:'CONDITION'}, false],
    [{kind:'field',blockId:'anchor'}, false],
    [{kind:'block',blockId:'anchor'}, false],
    [{kind:'gap',blockId:'missing'}, false]
])('only offers a call at a native statement boundary %j', (position, accepts) => {
    const f = completionFixture();
    expect(acceptsProcedureCall(f.workspace, position, f.ScratchBlocks)).toBe(accepts);
    const choices = f.completion.choices(position, 'define jump');
    expect(choices).toHaveLength(accepts ? 2 : 0);
    if (accepts) expect(choices[0]).toMatchObject({fits:true,insertCall:true,definitionId:null});
});

test('rejects insertion above hats and below caps', () => {
    const f = completionFixture();
    f.anchor.previousConnection = null;
    f.anchor.nextConnection = null;
    for (const kind of ['before','gap']) {
        expect(f.completion.choices({kind,blockId:'anchor'},'define jump')).toEqual([]);
    }
});

test('workspace declarations stay definition-only and reject duplicates', () => {
    const f = completionFixture();
    expect(f.completion.choices({kind:'workspace',x:50,y:60},'define jump')[0])
        .toMatchObject({fits:true,insertCall:false});
    f.ScratchBlocks.Procedures.getDefineBlock.mockReturnValue({id:'definition'});
    expect(f.completion.choices({kind:'gap',blockId:'anchor'},'define jump :: warp')).toHaveLength(1);
    expect(f.completion.choices({kind:'workspace'},'define jump')[0])
        .toMatchObject({fits:false,insertCall:false,error:expect.stringContaining('already exists')});
    expect(f.completion.choices({kind:'gap',blockId:'anchor'},'define jump')[0])
        .toMatchObject({fits:true,definitionId:'definition',description:'Use existing custom block'});
});

test('does not turn an existing custom reporter into a statement call', () => {
    const f = completionFixture();
    f.ScratchBlocks.Procedures.getDefineBlock.mockReturnValue({id:'definition'});
    f.ScratchBlocks.Procedures.getProcedureReturnType.mockReturnValue(1);
    expect(f.completion.choices({kind:'gap',blockId:'anchor'},'define jump')[0])
        .toMatchObject({fits:false,error:expect.stringContaining('statement slot')});
});

test('incomplete inline declarations preview calls, never definitions or live objects', () => {
    const f = completionFixture();
    const choice = f.completion.choices({kind:'gap',blockId:'anchor'},'define jump (he')[0];
    expect(choice).toMatchObject({fits:false,insertCall:true});
    const xml = f.completion.previewXml(choice);
    expect(xml.getAttribute('type')).toBe('procedures_call');
    expect(xml.querySelector('mutation').getAttribute('proccode')).toBe('jump %s');
    expect(xml.querySelector('mutation').getAttribute('generateshadows')).toBe('true');
    expect(f.ScratchBlocks.Xml.domToBlock).not.toHaveBeenCalled();
    expect(f.ScratchBlocks.utils.genUid).not.toHaveBeenCalled();
});

test('call XML retains native identity flags without mutating the definition mutation', () => {
    const f = completionFixture();
    const mutation = document.createElement('mutation');
    for (const [name,value] of Object.entries({proccode:'jump %s',argumentids:'["real-id"]',warp:'true'})) {
        mutation.setAttribute(name,value);
    }
    const call = procedureCallXml(mutation, f.ScratchBlocks);
    expect(call.querySelector('mutation').getAttribute('argumentids')).toBe('["real-id"]');
    expect(call.querySelector('mutation').getAttribute('warp')).toBe('true');
    expect(mutation.hasAttribute('generateshadows')).toBe(false);
    const definition = {id:'definition', getInputTargetBlock: () => ({mutationToDom: () => mutation})};
    f.blocks.set(definition.id,definition);
    f.ScratchBlocks.Procedures.getDefineBlock.mockReturnValue(definition);
    const choice = f.completion.choices({kind:'gap',blockId:'anchor'},'define jump (other name)')[0];
    expect(f.completion.previewXml(choice).querySelector('mutation').getAttribute('argumentids'))
        .toBe('["real-id"]');
});

test.each(['target','anchor','definition','incomplete'])('refuses a stale %s before any creation', change => {
    const f = completionFixture();
    const position = {kind:'gap',blockId:'anchor'};
    const choice = f.completion.choices(position, 'define jump')[0];
    if (change === 'target') f.vm.editingTarget.id = 'another-sprite';
    if (change === 'anchor') f.blocks.clear();
    if (change === 'definition') f.ScratchBlocks.Procedures.getDefineBlock.mockReturnValue({id:'new-definition'});
    if (change === 'incomplete') { choice.procCode = undefined; choice.error = 'Close the argument'; }
    expect(() => f.completion.apply(position,choice,'sprite')).toThrow('has changed');
    expect(f.ScratchBlocks.Xml.domToBlock).not.toHaveBeenCalled();
});
