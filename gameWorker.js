// Simple background tick worker
let tickMs = 200; // default 5 FPS
let last = Date.now();
let timer = setInterval(()=>{
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    postMessage({type: 'tick', dt});
}, tickMs);

onmessage = (e) => {
    if(!e || !e.data) return;
    const d = e.data;
    if(d.type === 'setTickMs' && typeof d.value === 'number'){
        clearInterval(timer);
        tickMs = Math.max(20, d.value|0);
        timer = setInterval(()=>{
            const now = Date.now();
            const dt = (now - last) / 1000;
            last = now;
            postMessage({type: 'tick', dt});
        }, tickMs);
    }
    if(d.type === 'stop'){
        clearInterval(timer);
        close();
    }
};
