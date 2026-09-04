import {resultNavigationDirection} from '../../../src/addons/addons/find-bar/result-navigation';

test.each([
    [{key:'F3'},1], [{key:'F3',shiftKey:true},-1],
    [{key:'g',ctrlKey:true},1], [{key:'G',ctrlKey:true,shiftKey:true},-1],
    [{key:'g',metaKey:true},1], [{key:'G',metaKey:true,shiftKey:true},-1],
    [{key:'F3',ctrlKey:true},0], [{key:'F3',metaKey:true},0],
    [{key:'F3',altKey:true},0], [{key:'g'},0], [{key:'G',shiftKey:true},0],
    [{key:'g',ctrlKey:true,altKey:true},0], [{key:'ArrowLeft'},0], [{key:'ArrowRight'},0],
    [{key:'F3',isComposing:true},0], [{key:'F3',defaultPrevented:true},0], [{},0]
])('result cycling respects modifiers and input ownership: %j', (event, direction) => {
    expect(resultNavigationDirection(event)).toBe(direction);
});
