import {navigate, positionKey} from './navigation';
import {horizontalSpan} from './navigation-spatial';

const locationKey = position => (position && position.kind === 'workspace' ?
    `workspace:${position.x}:${position.y}:${position.baselineY ?? ''}` : positionKey(position));

// Session-only intent: a deliberate column crossing and its original vertical
// band. Pure topology remains authoritative; no block/SVG objects are retained.
class NavigationSession {
    constructor () {
        this.heldKeys = new Set();
        this.cancel();
    }
    cancel () {
        this.pending = null;
        this.lane = null;
    }
    cancelBoundary () {
        this.pending = null;
    }
    keyDown (key, repeat = false) {
        if (!['ArrowLeft', 'ArrowRight'].includes(key)) this.cancel();
        const held = repeat || this.heldKeys.has(key);
        this.heldKeys.add(key);
        return held;
    }
    keyUp (key) {
        this.heldKeys.delete(key);
    }
    blur () {
        this.heldKeys.clear();
        this.cancel();
    }
    move (stops, position, key, {repeat = false, backwards = false, range = null} = {}) {
        const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
        if (!horizontal || (this.lane && this.lane.at !== locationKey(position))) this.cancel();
        const destination = navigate(stops, position, key, backwards, range, this.lane?.span);
        const source = stops.find(stop => positionKey(stop) === positionKey(position)) ||
            (position.kind === 'before' && stops.find(stop => stop.kind === 'block' &&
                stop.blockId === position.blockId));
        const target = stops.find(stop => positionKey(stop) === positionKey(destination));
        const crossing = horizontal && source &&
            (destination.kind === 'workspace' || (target && source.scriptId !== target.scriptId));
        const spatial = crossing || (horizontal && position.kind === 'workspace');
        if (spatial && !this.lane) {
            const span = horizontalSpan(stops, source || position, range);
            if (span) {
                this.lane = {span: {y: span.y,
                    height: span.height,
                    ...(Number.isFinite(span.originY) ? {originY: span.originY} : {}),
                    ...(Number.isFinite(span.baselineY) ? {baselineY: span.baselineY} : {})},
                at: locationKey(position)};
            }
        }
        if (!crossing) {
            if (spatial) {
                this.cancelBoundary();
                if (this.lane) this.lane.at = locationKey(destination);
            } else this.cancel();
            return {position: destination, blocked: false};
        }
        const signature = `${locationKey(position)}|${key}|${locationKey(destination)}`;
        if (this.pending && this.pending.signature === signature && !repeat) {
            this.cancelBoundary();
            if (this.lane) this.lane.at = locationKey(destination);
            return {position: destination, blocked: false};
        }
        this.pending = {signature, key, direction: key === 'ArrowRight' ? 'right' : 'left'};
        return {position, blocked: true};
    }
}

export {NavigationSession, locationKey};
