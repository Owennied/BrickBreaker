// Brick Breaker with a shop: buy balls, release them to break bricks and earn money.
(() => {
	const canvas = document.getElementById('gameCanvas');
	const ctx = canvas.getContext('2d');

	// UI elements
	const moneyEl = document.getElementById('money');
	const ballsOwnedEl = document.getElementById('ballsOwned');
	const buyBallBtn = document.getElementById('buyBall');
	const releaseBtn = document.getElementById('releaseBalls');

	// Hi-DPI scaling
	function fitCanvas() {
		const cssW = canvas.width;
		const cssH = canvas.height;
		const dpr = Math.max(1, window.devicePixelRatio || 1);
		canvas.width = cssW * dpr;
		canvas.height = cssH * dpr;
		canvas.style.width = cssW + 'px';
		canvas.style.height = cssH + 'px';
		ctx.setTransform(dpr,0,0,dpr,0,0);
	}
	fitCanvas();

	// Game state
	let money = 50; // starting money to let player buy a ball
	let ballPrice = 10;
	let ballsOwned = 0; // in inventory; release moves them into activeBalls

	const activeBalls = [];
	const bricks = [];

	const GAME = {
		width: parseInt(canvas.style.width || canvas.width || 800, 10) || 800,
		height: parseInt(canvas.style.height || canvas.height || 600, 10) || 600,
	};

	// Brick layout
	function initBricks(){
		bricks.length = 0;
		const rows = 5;
		const cols = 10;
		const padding = 6;
		const offsetTop = 40;
		const totalPad = padding * (cols + 1);
		const brickW = Math.floor((GAME.width - totalPad) / cols);
		const brickH = 22;

		for(let r=0;r<rows;r++){
			for(let c=0;c<cols;c++){
				const x = padding + c * (brickW + padding);
				const y = offsetTop + r * (brickH + padding);
				bricks.push({x,y,w:brickW,h:brickH,value:10,alive:true});
			}
		}
	}

	initBricks();

	function updateUI(){
		moneyEl.textContent = `Money: $${money}`;
		ballsOwnedEl.textContent = `Balls: ${ballsOwned}`;
		buyBallBtn.textContent = `Buy Ball ($${ballPrice})`;
	}
	updateUI();

	function buyBall(){
		if(money >= ballPrice){
			money -= ballPrice;
			ballsOwned += 1;
			// scale price up slowly
			ballPrice = Math.max(5, Math.round(ballPrice * 1.15));
			updateUI();
		} else {
			// could flash UI in the future
			console.log('Not enough money');
		}
	}

	buyBallBtn.addEventListener('click', buyBall);

	function releaseBalls(){
		if(ballsOwned <= 0) return;
		const n = ballsOwned;
		for(let i=0;i<n;i++){
			const spread = (i - (n-1)/2) * 3; // small horizontal spread
			activeBalls.push({
				x: GAME.width/2 + spread,
				y: GAME.height - 28,
				vx: (Math.random()-0.5)*2 + spread*0.03,
				vy: -6 - Math.random()*1.6,
				r:6,
				alive:true
			});
		}
		ballsOwned = 0;
		updateUI();
	}
	releaseBtn.addEventListener('click', releaseBalls);

	// allow clicking canvas to release a single free test ball
	canvas.addEventListener('click', () => {
		activeBalls.push({x: GAME.width/2, y: GAME.height-28, vx:(Math.random()-0.5)*4, vy:-6, r:6, alive:true});
	});

	function circleRectCollision(ball, rect){
		const nearestX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
		const nearestY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
		const dx = ball.x - nearestX;
		const dy = ball.y - nearestY;
		return (dx*dx + dy*dy) <= (ball.r * ball.r);
	}

	// Main loop
	const gravity = 0.12; // low gravity for a gliding feel
	const bounce = 0.9;

	function update(dt){
		// update balls
		for(let i = activeBalls.length-1; i>=0; i--){
			const b = activeBalls[i];
			b.vy += gravity;
			b.x += b.vx;
			b.y += b.vy;

			// wall collisions
			if(b.x - b.r < 0){ b.x = b.r; b.vx = -b.vx * bounce; }
			if(b.x + b.r > GAME.width){ b.x = GAME.width - b.r; b.vx = -b.vx * bounce; }
			if(b.y - b.r < 0){ b.y = b.r; b.vy = -b.vy * bounce; }

					// floor: bounce off bottom so balls stay inside the level
					if (b.y + b.r > GAME.height) {
						// push back to the surface and reflect velocity
						b.y = GAME.height - b.r;
						b.vy = -b.vy * bounce;
						// small horizontal friction
						b.vx *= 0.995;
					}

			// brick collisions
			for(let j=0;j<bricks.length;j++){
				const br = bricks[j];
				if(!br.alive) continue;
				if(circleRectCollision(b, br)){
					// remove brick
					br.alive = false;
					// simple reflection: reverse vy
					b.vy = -b.vy * 0.9;
					money += br.value;
					updateUI();
					break;
				}
			}
		}
	}

	function draw(){
		ctx.clearRect(0,0,GAME.width,GAME.height);

		// draw bricks
		for(const br of bricks){
			if(!br.alive) continue;
			// color based on y position
			const hue = 200 - Math.floor((br.y / GAME.height) * 80);
			ctx.fillStyle = `hsl(${hue}deg 70% 55%)`;
			ctx.fillRect(br.x, br.y, br.w, br.h);
			ctx.strokeStyle = 'rgba(0,0,0,0.25)';
			ctx.strokeRect(br.x, br.y, br.w, br.h);
		}

		// draw balls
		for(const b of activeBalls){
			ctx.beginPath();
			ctx.fillStyle = '#ffd166';
			ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
			ctx.fill();
			ctx.closePath();
		}

		// HUD
		ctx.fillStyle = 'rgba(255,255,255,0.06)';
		ctx.fillRect(0, GAME.height-30, GAME.width, 30);
		ctx.fillStyle = '#cfe8ff';
		ctx.font = '12px system-ui,Segoe UI,Roboto';
		ctx.fillText(`Active balls: ${activeBalls.length}`, 8, GAME.height-10);
	}

	let last = performance.now();
	function loop(now){
		const dt = (now - last)/1000;
		last = now;
		update(dt);
		draw();
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);

	// handle window resize to keep game size consistent
	window.addEventListener('resize', ()=>{
		// do nothing complicated: keep canvas pixel dims as set in HTML, but re-fit HiDPI
		fitCanvas();
	});

	// Expose some helpers on window for debugging
	window._game = {money: ()=>money, bricks, activeBalls};

	// small keyboard shortcuts
	window.addEventListener('keydown', (e)=>{
		if(e.key === 'b') buyBall();
		if(e.key === 'r') releaseBalls();
		if(e.key === 'n') {
			// refill bricks
			initBricks();
		}
	});

})();

