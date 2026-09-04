import {accepts} from './operations';
import {resolveConnection} from './navigation';

const isBooleanOnlyConnection = connection => Boolean(connection && connection.type === 1 &&
    Array.isArray(connection.check_) && connection.check_.includes('Boolean') &&
    !connection.check_.includes('String') && !connection.check_.includes('Number'));

const completionChoicesForConnection = (connection, positionKind, matches, value, variables = [], commands = [],
    search = '', fits = () => true) => {
    const blocks = matches.filter(({instance}) => !connection || connection.type !== 1 ||
        (instance.typeInfo.shape.canBeRound &&
            connection.checkType_(instance.typeInfo.workspaceForm.outputConnection)))
        .map(result => ({...result,
            kind: 'block',
            fits: fits(result.instance)}));
    const hasValue = typeof value === 'string';
    const existing = variables.filter(choice => ['variable', 'list'].includes(choice.kind));
    const create = variables.filter(choice => ['create-variable', 'create-list'].includes(choice.kind));
    // Identity-labelled variable rows replace the parser's duplicate getter
    // rows, but normal blocks and the explicit literal option keep their order.
    const identityReporterTypes = new Set(existing.map(choice => (choice.kind === 'list' ?
        'data_listcontents' : 'data_variable')));
    const ordinary = existing.length ? blocks.filter(choice =>
        !identityReporterTypes.has(choice.instance.typeInfo.workspaceForm.type)) : blocks;
    // The parser's textual order is still authoritative between equally valid
    // candidates, but a short prefix must not put an incompatible reporter or
    // hat ahead of a statement which can actually be inserted here. At a loose
    // workspace position, hats and caps are statement shapes too; only a
    // reporter is demoted. This is a connection-level rule, not an opcode
    // ranking.
    const query = (search || (typeof value === 'string' ? value : '')).trim().toLowerCase();
    const ranked = ordinary.map((choice, index) => ({
        choice,
        index,
        exact: Boolean(query) && choice.text.trim().toLowerCase() === query
    }))
        .sort((a, b) => Number(b.exact) - Number(a.exact) ||
            Number(b.choice.fits) - Number(a.choice.fits) ||
            (positionKind === 'workspace' ?
                Number(b.choice.instance.typeInfo.shape.canStackUp ||
                    b.choice.instance.typeInfo.shape.canStackDown) -
                    Number(a.choice.instance.typeInfo.shape.canStackUp ||
                        a.choice.instance.typeInfo.shape.canStackDown) : 0) || a.index - b.index)
        .map(({choice}) => choice);
    const exactExisting = query ? existing.filter(choice => choice.text.toLowerCase() === query) : [];
    const fuzzyExisting = query ? existing.filter(choice => !exactExisting.includes(choice)) : existing;
    // In a value slot, identities are the most direct answer. At a statement or
    // loose-script caret, a short block-name prefix should lead before a fuzzy
    // identity substring ("m" -> move, not the default "my variable"). Exact
    // identity names still lead wherever they are valid.
    const identitiesFirst = connection && connection.type === 1;
    const ordered = identitiesFirst ? [...existing, ...ranked] : [...exactExisting, ...ranked, ...fuzzyExisting];
    const limited = ordered.slice(0, hasValue ? 6 : 7);
    // A complete number is already an unambiguous value. Keep complete block
    // and identity matches ahead of it, but do not let a parser completion
    // which still needs more text (for example "10 ^ of") displace the plain
    // number. This is deliberately numeric-only: ordinary text continues to
    // prefer useful incomplete block completions, and "10 ^" is no longer a
    // complete number so the operator candidate leads normally.
    const numericLiteral = hasValue && value.trim() !== '' && Number.isFinite(Number(value.trim()));
    const literal = hasValue && {kind: 'value', text: value, fits: true};
    const choices = hasValue ? (numericLiteral ?
        [...limited.filter(choice => !choice.truncated), literal,
            ...limited.filter(choice => choice.truncated)] : [...limited, literal]) : limited;
    // An explicit declaration prefix beats an incomplete alternative such as
    // "set fish" -> "set fisheye effect", but never displaces a complete
    // existing match such as "set x to 10" or an existing variable command.
    return commands.length ? [...choices.filter(choice => !choice.truncated), ...commands,
        ...choices.filter(choice => choice.truncated), ...create] : choices.concat(create);
};

// Connection shape is a filter; an occupied, otherwise compatible input is
// still shown as protected. Never substitute a statement into a value slot.
const completionChoices = (workspace, position, matches, value, variables = [], commands = [], search = '',
    replacementBlockId = null) => {
    const connection = resolveConnection(workspace, position);
    return completionChoicesForConnection(connection, position.kind, matches, value, variables, commands, search,
        instance => accepts(workspace, position, instance, replacementBlockId));
};

export {completionChoices, completionChoicesForConnection, isBooleanOnlyConnection};
