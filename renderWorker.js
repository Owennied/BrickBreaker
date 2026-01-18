// Render worker: draws game state to an OffscreenCanvas provided by main thread.
let canvas = null;
let ctx = null;
let W = 800, H = 600;

onmessage = (e) => {
    if(!e || !e.data) return;
    const d = e.data;
    if(d.type === 'init' && d.canvas){
        canvas = d.canvas;
        W = d.width || canvas.width || 800;
        H = d.height || canvas.height || 600;
        try{ ctx = canvas.getContext('2d'); }catch(e){ ctx = null; }
        return;
    }
    if(d.type === 'state' && ctx){
        const s = d.state;
        // clear
        ctx.clearRect(0,0,W,H);
        // background - simple dark gradient
        const g = ctx.createLinearGradient(0,0,0,H);
        g.addColorStop(0,'#041826');
        g.addColorStop(1,'#071a14');
        ctx.fillStyle = g;
        ctx.fillRect(0,0,W,H);
        // draw bricks
        if(s && Array.isArray(s.bricks)){
            for(const br of s.bricks){
                if(!br.alive) continue;
                ctx.save();
                ctx.fillStyle = '#3aa0ff';
                ctx.fillRect(br.x, br.y, br.w, br.h);
                ctx.restore();
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.strokeRect(br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1);
                // value
                ctx.fillStyle = '#fff';
                ctx.font = '12px system-ui,Segoe UI,Roboto';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`$${br.value}`, br.x + br.w/2, br.y + br.h/2);
            }
        }
        // draw balls
        if(s && Array.isArray(s.balls)){
            for(const b of s.balls){
                const color = (b.type === 'heavy') ? '#ff6b66' : (b.type === 'sniper' ? '#9f7aea' : (b.type === 'scatter' ? '#60a5fa' : '#ffd166'));
                ctx.save();
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
                ctx.fill();
                ctx.restore();
            }
        }
        // boss
        if(s && s.boss && s.boss.alive){
            ctx.save();
            ctx.fillStyle = '#ff9b9b';
            ctx.beginPath();
            ctx.arc(s.boss.x, s.boss.y, s.boss.r, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '14px system-ui,Segoe UI,Roboto';
            ctx.textAlign = 'center';
            ctx.fillText(`Boss HP: ${s.boss.value}`, s.boss.x, s.boss.y);
            ctx.restore();
        }
        // HUD text
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, H-30, W, 30);
    }
    if(d.type === 'stop'){
        close();
    }
};
