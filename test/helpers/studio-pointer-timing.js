// Measure painted pointer frames. Never infer a pause from configuration or
// insert waits into playback to make the assertions pass.
const beginPointerTiming = driver => driver.executeScript(`
    const trace=window.__spritePointerTiming={active:true,frames:[],clicks:[]};
    const onClick=event=>{
        const control=event.target.closest('[data-studio-sprite-name],[data-studio-target],[data-studio-library-key]');
        if(control)trace.clicks.push({time:performance.now(),
            name:control.dataset.studioSpriteName || control.dataset.studioTarget || control.dataset.studioLibraryKey,
            point:{x:event.clientX,y:event.clientY}});
    };
    document.addEventListener('click',onClick,true);
    const tick=()=>{
        if(!trace.active){document.removeEventListener('click',onClick,true);return;}
        const pointer=document.getElementById('tw-studio-native-pointer');
        trace.frames.push({time:performance.now(),
            sprites:[...document.querySelectorAll('[data-studio-sprite-name]')].map(e=>e.dataset.studioSpriteName),
            selected:[...document.querySelectorAll('[data-studio-sprite-name]')]
                .find(e=>e.className.includes('is-selected'))?.dataset.studioSpriteName,
            pointer:pointer && getComputedStyle(pointer).visibility!=='hidden' &&
                Number(getComputedStyle(pointer).opacity)>0 ?
                {x:parseFloat(pointer.style.left),y:parseFloat(pointer.style.top),
                    pressed:pointer.dataset.pressed==='true'}:null});
        requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
`);

const endPointerTiming = driver => driver.executeScript(
    'window.__spritePointerTiming.active=false;return window.__spritePointerTiming;');

const clickTiming = (trace, click) => {
    const before = trace.frames.filter(frame => frame.time <= click.time);
    const press = before.findLastIndex(frame => frame.pointer?.pressed);
    if (press < 0) throw new Error(`No visible press for ${click.name}`);
    let pressStart = press;
    while (pressStart > 0 && before[pressStart - 1].pointer?.pressed) pressStart--;
    let arrival = pressStart;
    // MouseEvent client coordinates can be rounded to device pixels; the
    // overlay retains its subpixel endpoint. Measure rest against that point.
    const endpoint = before[pressStart].pointer;
    if (Math.hypot(endpoint.x - click.point.x, endpoint.y - click.point.y) > 2) {
        throw new Error(`Pointer did not click on ${click.name}`);
    }
    const atTarget = frame => frame.pointer &&
        Math.hypot(frame.pointer.x - endpoint.x, frame.pointer.y - endpoint.y) < 0.05;
    while (arrival > 0 && atTarget(before[arrival - 1])) arrival--;
    const nextMove = trace.frames.find(frame => frame.time > click.time && frame.pointer &&
        Math.hypot(frame.pointer.x - endpoint.x, frame.pointer.y - endpoint.y) > 1);
    return {
        beforePressMs: before[pressStart].time - before[arrival].time,
        afterClickMs: nextMove ? nextMove.time - click.time : null,
        arrival: before[arrival],
        press: before[pressStart]
    };
};

export {beginPointerTiming, endPointerTiming, clickTiming};
