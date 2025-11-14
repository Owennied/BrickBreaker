// Brick Breaker with a shop: buy balls, release them to break bricks and earn money.
(() => {
	const canvas = document.getElementById('gameCanvas');
	const ctx = canvas.getContext('2d');

	// UI elements
	const moneyEl = document.getElementById('money');
	const ballsOwnedEl = document.getElementById('ballsOwned');
	const buyBallBtn = document.getElementById('buyBall');
	const buyBtn = document.getElementById('buyBtn');
	const buyMenu = document.getElementById('buyMenu');
	const resetBtn = document.getElementById('resetBtn');

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
	const START_MONEY = 0; // starting money to let player buy a ball
	const START_BALL_PRICE = 10;
	// maximum number of balls that can be active at once
	const MAX_ACTIVE_BALLS = 20;
	let money = START_MONEY;
	let ballPrice = START_BALL_PRICE;
	let ballsOwned = 0; // in inventory; release moves them into activeBalls
	let level = 1; // current level

	const activeBalls = [];
	const bricks = [];

	const GAME = {
		width: parseInt(canvas.style.width || canvas.width || 800, 10) || 800,
		height: parseInt(canvas.style.height || canvas.height || 600, 10) || 600,
	};

	// Brick layout
	function initBricks(lvl = 1){
		bricks.length = 0;
		// scale layout with level
		const rows = Math.min(8, 4 + Math.floor((lvl-1)/1));
		const cols = Math.min(12, 7 + Math.floor((lvl-1)/2));
		const padding = 6;
		const offsetTop = 40;
		const totalPad = padding * (cols + 1);
		const brickW = Math.floor((GAME.width - totalPad) / cols);
		const brickH = 22;

		// determine max hp for this level (harder as level increases)
		const maxHp = Math.min(6, 2 + Math.floor(lvl/2));

		for(let r=0;r<rows;r++){
			for(let c=0;c<cols;c++){
				const x = padding + c * (brickW + padding);
				const y = offsetTop + r * (brickH + padding);
				// base HP influenced by row and level (used previously) -> we'll use it to determine monetary value
				const baseHp = 1 + Math.floor((r / Math.max(1, rows-1)) * (maxHp-1));
				const hp = baseHp + Math.floor(Math.random() * Math.max(1, Math.ceil(lvl/3)) );
				let finalHp = Math.min(maxHp, hp);
				finalHp = Math.max(2, finalHp);
				// value equals health in dollars; scale with level
				const value = 10 * finalHp * lvl;
				bricks.push({x,y,w:brickW,h:brickH,value,alive:true,maxValue:value});
			}
		}
		console.log('initBricks: created', bricks.length, 'bricks');
	}

	initBricks();

	// inventory by type (declared early so loadGame can restore into it)
	const ballsByType = {};
	// default starting inventory: give the player 20 standard balls by default
	ballsByType['standard'] = 20;
	// upgrades object must be declared early so loadGame can restore into it
	const upgrades = {};

	// current prices per ball type (will scale up as player buys)
	const pricesByType = {};
	// detect whether the game has been run before; used to avoid re-spawning defaults after a reset
	const _seenFlag = localStorage.getItem('brickbreaker-seen');
	const firstRun = !_seenFlag;

	// Try to load saved game state (if any)
	function loadGame(){
		try{
			const raw = localStorage.getItem('brickbreaker-save');
			if(!raw) return false;
			const obj = JSON.parse(raw);
			if(!obj) return false;
			// restore simple values
			if(typeof obj.money === 'number') money = obj.money;
			if(typeof obj.ballPrice === 'number') ballPrice = obj.ballPrice;
			if(typeof obj.ballsOwned === 'number') ballsOwned = obj.ballsOwned;
			if(obj.ballsByType) Object.assign(ballsByType, obj.ballsByType);
			if(obj.upgrades) Object.assign(upgrades, obj.upgrades);
			if(obj.pricesByType) Object.assign(pricesByType, obj.pricesByType);
			// restore bricks if present
			if(typeof obj.level === 'number') level = obj.level || 1;
			if(Array.isArray(obj.bricks)){
				bricks.length = 0;
				for(const b of obj.bricks){
					// restore props (x,y,w,h,value,alive,maxValue)
					const val = (typeof b.value === 'number') ? +b.value : ((typeof b.hp === 'number') ? +b.hp : ((typeof b.maxHp === 'number') ? +b.maxHp : 0));
					const maxV = (typeof b.maxValue === 'number') ? +b.maxValue : val;
					bricks.push({
						x:+b.x,
						y:+b.y,
						w:+b.w,
						h:+b.h,
						value: val,
						maxValue: maxV,
						alive: (val > 0) && !!b.alive
					});
				}
			}
			return true;
		}catch(e){
			console.warn('Failed to load save', e);
			return false;
		}
	}

	function saveGame(){
		try{
			const obj = {
				version: 1,
				money,
				ballPrice,
				ballsOwned,
				ballsByType,
				level,
				upgrades,
				pricesByType,
				bricks: bricks.map(b => ({x:b.x,y:b.y,w:b.w,h:b.h,value:b.value,alive:!!b.alive,maxValue: b.maxValue || b.value})),
				lastSaved: Date.now()
			};
			localStorage.setItem('brickbreaker-save', JSON.stringify(obj));
		}catch(e){
			console.warn('Failed to save game', e);
		}
	}

	// apply monetary damage to a brick: dmg is in dollars. Award the min(dmg, remaining value).
	// returns the total awarded amount
	function applyDamageToBrick(br, dmg){
		if(!br || !br.alive) return 0;
		const amount = Math.min(dmg, Math.max(0, br.value));
		if(amount <= 0) return 0;
		br.value = Math.max(0, br.value - amount);
		money += amount;
		updateUI();
		saveGame();
		if(br.value <= 0){
			br.alive = false;
			if(bricks.every(b => !b.alive)){
				setTimeout(()=>{
					level += 1;
					initBricks(level);
					saveGame();
					console.log('Level up! Now', level);
				}, 700);
			}
		}
		return amount;
	}

	// attempt to load saved state (overrides initial bricks if present)
	const _loaded = loadGame();
	// spawn logic:
	// - if a saved game exists, spawn according to saved counts
	// - else if this is the first-ever run (no seen flag), spawn defaults and mark seen
	const centerX = GAME.width/2;
	const centerY = GAME.height/2;
	let availableSpawn = Math.max(0, MAX_ACTIVE_BALLS - activeBalls.length);
	if(_loaded){
		for(const t of Object.keys(ballsByType)){
			if(availableSpawn <= 0) break;
			const count = ballsByType[t] || 0;
			const toSpawn = Math.min(count, availableSpawn);
			for(let i=0;i<toSpawn;i++){
				const jitter = 6; // pixels
				spawnBall(t, centerX + (Math.random()-0.5)*jitter, centerY + (Math.random()-0.5)*jitter);
			}
			availableSpawn -= toSpawn;
		}
	} else if(firstRun){
		// first-ever run: spawn the default starting balls, then mark we've seen the game
		for(const t of Object.keys(ballsByType)){
			if(availableSpawn <= 0) break;
			const count = ballsByType[t] || 0;
			const toSpawn = Math.min(count, availableSpawn);
			for(let i=0;i<toSpawn;i++){
				const jitter = 6;
				spawnBall(t, centerX + (Math.random()-0.5)*jitter, centerY + (Math.random()-0.5)*jitter);
			}
			availableSpawn -= toSpawn;
		}
		try{ localStorage.setItem('brickbreaker-seen','1'); }catch(e){}
	}
	// update UI to reflect restored money/balls
	updateUI();

	function updateUI(){
		moneyEl.textContent = `Money: $${money}`;
		// show active balls and capacity
		ballsOwnedEl.textContent = `Balls: ${activeBalls.length}/${MAX_ACTIVE_BALLS}`;
		// support both old single-buy button and new buy dropdown button
		if(typeof buyBallBtn !== 'undefined' && buyBallBtn && buyBallBtn.textContent !== undefined){
			buyBallBtn.textContent = `Buy Ball ($${ballPrice})`;
		}
		if(typeof buyBtn !== 'undefined' && buyBtn && buyBtn.textContent !== undefined){
			buyBtn.textContent = 'Ball Menu';
		}
	}
	updateUI();

	// save periodically in case of long sessions (every 15s)
	setInterval(()=>{
		saveGame();
	}, 15000);

	function buyBall(){
		// legacy buy button: buy one standard ball using current ballPrice
		const curPrice = pricesByType['standard'] || ballPrice;
		if(purchaseBall('standard', 1, curPrice)){
			// scale price up slowly after successful purchase
			pricesByType['standard'] = Math.max(1, Math.round(curPrice * 1.15));
			updateUI();
		}
	}

	// Centralized purchase helper: buys `count` balls of `type` at `price` each (price optional)
	// Returns true if purchase succeeded.
	function purchaseBall(type = 'standard', count = 1, price = null){
		const typeDef = BALL_TYPES.find(t => t.id === type) || null;
		const unitPrice = (typeof price === 'number' && price > 0) ? price : (pricesByType[type] || (typeDef ? typeDef.price : START_BALL_PRICE));
		// enforce active ball capacity
		const available = Math.max(0, MAX_ACTIVE_BALLS - activeBalls.length);
		if(available <= 0) return false;
		const wanted = Math.max(0, count);
		const actualCount = Math.min(wanted, available);
		const total = unitPrice * actualCount;
		if(actualCount <= 0) return false;
		if(money < total) return false;
		money -= total;
		for(let i=0;i<actualCount;i++) spawnBall(type);
		ballsByType[type] = (ballsByType[type] || 0) + actualCount;
		updateUI();
		saveGame();
		return true;
	}

	// helper to count active balls of a given type
	function countActiveOfType(type){
		let n = 0;
		for(const b of activeBalls) if(b.type === type) n++;
		return n;
	}

	// sell `count` balls of a given type. Returns number sold.
	function sellBall(type = 'standard', count = 1, unitPrice = null){
		const owned = ballsByType[type] || 0;
		const toSell = Math.min(owned, Math.max(0, count));
		if(toSell <= 0) return 0;
		const typeDef = BALL_TYPES.find(t => t.id === type) || null;
		const curBuy = (typeof unitPrice === 'number' && unitPrice > 0) ? unitPrice : (pricesByType[type] || (typeDef ? typeDef.price : 0));
		const sellUnit = curBuy ? Math.floor(curBuy * 0.5) : 0;
		const total = sellUnit * toSell;
		// remove up to `toSell` active balls of this type
		let removed = 0;
		for(let i = activeBalls.length - 1; i >= 0 && removed < toSell; i--){
			if(activeBalls[i].type === type){
				activeBalls.splice(i,1);
				removed++;
			}
		}
		// decrement inventory
		ballsByType[type] = Math.max(0, owned - toSell);
		money += total;
		updateUI();
		saveGame();
		return toSell;
	}

	if(buyBallBtn) buyBallBtn.addEventListener('click', buyBall);

	// Toggle buy dropdown (if present) and populate with ball types
	const BALL_TYPES = [
		{ id: 'standard', name: 'Standard', price: 10, desc: 'Balanced ball' },
		{ id: 'heavy', name: 'Heavy', price: 25, desc: 'Slower, more momentum' },
		{ id: 'bouncy', name: 'Bouncy', price: 40, desc: 'High bounce, faster rebounds' }
	];


	// inventory by type (for future use)
	// Only set a default 0 if the loaded save didn't already set a count for that type
	for(const t of BALL_TYPES) if(!(t.id in ballsByType)) ballsByType[t.id] = 0;
	// initialize upgrades defaults
	for(const t of BALL_TYPES) if(!(t.id in upgrades)) upgrades[t.id] = 0;
	// initialize per-type prices (may be overridden by saved data)
	for(const t of BALL_TYPES) if(!(t.id in pricesByType)) pricesByType[t.id] = t.price;

	// build buy menu without descriptions (names + actions only)
	const helpBtn = document.getElementById('helpBtn');
	const helpMenu = document.getElementById('helpMenu');

	if(buyBtn && buyMenu){
		function renderBuyMenu(){
			buyMenu.innerHTML = BALL_TYPES.map(t => {
				const lvl = upgrades[t.id] || 0;
				const upgradeCost = 50 * (lvl + 1);
				const curPrice = pricesByType[t.id] || t.price;
				return `
					<div class="ball-type" data-id="${t.id}">
						<div class="ball-meta"><strong>${t.name}</strong>
							<div class="owned">Owned: ${ballsByType[t.id] || 0}</div>
						</div>
						<div class="actions">
							<button class="buy-one" data-id="${t.id}" data-price="${curPrice}">Buy 1 ($${curPrice})</button>
							<button class="buy-max" data-id="${t.id}" data-price="${curPrice}">Buy Max</button>
							<button class="sell-one" data-id="${t.id}" data-price="${curPrice}">Sell 1 ($${Math.floor(curPrice*0.5)})</button>
							<button class="sell-all" data-id="${t.id}" data-price="${curPrice}">Sell All</button>
							<button class="upgrade-dmg" data-id="${t.id}" data-cost="${upgradeCost}">Upgrade Dmg (+1) ($${upgradeCost})</button>
							<span class="upgrade-level">Lvl: ${lvl}</span>
						</div>
					</div>`;
			}).join('');
		}
		renderBuyMenu();

		// toggle buy menu visibility
		buyBtn.addEventListener('click', (e)=>{
			e.stopPropagation();
			buyMenu.classList.toggle('show');
			buyMenu.setAttribute('aria-hidden', buyMenu.classList.contains('show') ? 'false' : 'true');
			// ensure help menu is closed when opening buy menu
			if(helpMenu && helpMenu.classList.contains('show')){
				helpMenu.classList.remove('show');
				helpMenu.setAttribute('aria-hidden','true');
			}
		});

		// delegate clicks inside buy menu for buy-one and buy-max (use centralized purchase)
		buyMenu.addEventListener('click', (ev)=>{
			ev.stopPropagation();
			const btn = ev.target.closest('button');
			if(!btn) return;
			const type = btn.getAttribute('data-id');
			const price = parseInt(btn.getAttribute('data-price'), 10) || 0;
			if(btn.classList.contains('buy-one')){
				// attempt to purchase one of this type
				// do NOT close the menu after buying one so the player can buy multiple quickly
				if(purchaseBall(type, 1, price)){
					// scale the price for this type after a successful purchase
					const cur = pricesByType[type] || price || 1;
					pricesByType[type] = Math.max(1, Math.round(cur * 1.15));
					saveGame();
					renderBuyMenu();
				}
			} else if(btn.classList.contains('buy-max')){
				// compute buy max limited by funds and active-ball capacity
				const fundsMax = Math.floor(money / price);
				const available = Math.max(0, MAX_ACTIVE_BALLS - activeBalls.length);
				const max = Math.min(fundsMax, available);
				if(max <= 0) { console.log('No funds or capacity to buy any', type); return; }
				if(purchaseBall(type, max, price)){
					// scale price according to number bought
					const cur = pricesByType[type] || price || 1;
					pricesByType[type] = Math.max(1, Math.round(cur * Math.pow(1.15, max)));
					saveGame();
					renderBuyMenu();
					buyMenu.classList.remove('show');
					buyMenu.setAttribute('aria-hidden', 'true');
				}
			} else if(btn.classList.contains('upgrade-dmg')){
				const cost = parseInt(btn.getAttribute('data-cost'), 10) || 0;
				// upgrade cost may change after purchase; compute current cost
				const curLvl = upgrades[type] || 0;
				const curCost = 50 * (curLvl + 1);
				if(money < curCost){ console.log('Not enough money to upgrade', type); return; }
				money -= curCost;
				upgrades[type] = curLvl + 1;
				saveGame();
				updateUI();
				// re-render buy menu so labels & costs update
				renderBuyMenu();
			} else if(btn.classList.contains('sell-one')){
				const typeDef = BALL_TYPES.find(t => t.id === type) || null;
				const curPrice = pricesByType[type] || (typeDef ? typeDef.price : 0);
				const sellUnit = curPrice ? Math.floor(curPrice * 0.5) : 0;
				if(sellUnit <= 0) { console.log('Cannot sell', type); return; }
				if(sellBall(type, 1, sellUnit)){
					updateUI();
					renderBuyMenu();
				}
			} else if(btn.classList.contains('sell-all')){
				const typeDef = BALL_TYPES.find(t => t.id === type) || null;
				const curPrice = pricesByType[type] || (typeDef ? typeDef.price : 0);
				const sellUnit = curPrice ? Math.floor(curPrice * 0.5) : 0;
				if(sellUnit <= 0) { console.log('Cannot sell', type); return; }
				const owned = ballsByType[type] || 0;
				if(owned <= 0) { console.log('No balls to sell', type); return; }
				sellBall(type, owned, sellUnit);
				// close menu after selling all
				buyMenu.classList.remove('show');
				buyMenu.setAttribute('aria-hidden','true');
			}
		});

	}

	// build help menu content (descriptions) and wire the help button
	if(helpBtn && helpMenu){
		helpMenu.innerHTML = BALL_TYPES.map(t => `
			<div class="help-item">
				<div class="name">${t.name}</div>
				<div class="desc">${t.desc}</div>
			</div>
		`).join('') + `<button class="help-close" id="helpClose">Close</button>`;

		// smart toggle: show below if it fits, else above, otherwise open as centered modal
		// open help as a centered modal; create a backdrop so it feels modal
		helpBtn.addEventListener('click', (e)=>{
			e.stopPropagation();

			// close buy menu when opening help
			if(buyMenu && buyMenu.classList.contains('show')){
				buyMenu.classList.remove('show');
				buyMenu.setAttribute('aria-hidden','true');
			}

			// create backdrop
			let backdrop = document.getElementById('helpBackdrop');
			if(!backdrop){
				backdrop = document.createElement('div');
				backdrop.id = 'helpBackdrop';
				backdrop.className = 'help-backdrop';
				document.body.appendChild(backdrop);
			}
			// show modal and backdrop
			helpMenu.classList.add('modal','show');
			helpMenu.setAttribute('aria-hidden','false');
			backdrop.classList.add('show');

			// clicking backdrop closes the modal
			const closeHelp = ()=>{
				helpMenu.classList.remove('show','modal');
				helpMenu.setAttribute('aria-hidden','true');
				if(backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
			};
			backdrop.onclick = closeHelp;

			// wire close button
			const closeBtn = helpMenu.querySelector('#helpClose');
			if(closeBtn){
				closeBtn.onclick = closeHelp;
			}
		});
	}

	// close menus when clicking outside (applies to buyMenu)
	document.addEventListener('click', ()=>{
		if(buyMenu && buyMenu.classList.contains('show')){
			buyMenu.classList.remove('show');
			buyMenu.setAttribute('aria-hidden', 'true');
		}
		// if helpMenu is shown as modal, clicking outside will be handled by the backdrop,
		// otherwise ensure helpMenu is closed if it's open and no backdrop exists
		if(helpMenu && helpMenu.classList.contains('show')){
			const bd = document.getElementById('helpBackdrop');
			if(!bd){
				helpMenu.classList.remove('show');
				helpMenu.setAttribute('aria-hidden', 'true');
			}
		}
	});

	function releaseBalls(){
		if(ballsOwned <= 0) return;
		const n = ballsOwned;
		for(let i=0;i<n;i++){
			const spread = (i - (n-1)/2) * 3; // small horizontal spread
			activeBalls.push({
				x: GAME.width/2 + spread,
				y: GAME.height - 28,
				vx: (Math.random()-0.5)*1.2 + spread*0.03,
				vy: -3.5 - Math.random()*1.2,
				r:6,
				alive:true
			});
		}
		ballsOwned = 0;
		updateUI();
	}

	// helper to spawn a ball of a given type into the activeBalls array
	// optional x,y allow placing the ball at a specific position
function spawnBall(type = 'standard', x = null, y = null){
		let vx = (Math.random()-0.5)*1.2;
		let vy = -3.5 - Math.random()*1.2;
		let r = 6;
		// type-specific tweaks
		switch(type){
			case 'heavy':
				r = 8;
				vx *= 0.6;
				vy *= 0.6;
				break;
			case 'bouncy':
				r = 5;
				vx *= 1.4;
				vy *= 1.2;
				break;
			default:
				// standard
		}
		// determine damage from upgrades (default base damage is 1)
		const baseDamage = 1;
		const extra = (upgrades[type] || 0);
		const damage = baseDamage + extra;
		activeBalls.push({
			x: typeof x === 'number' ? x : (GAME.width/2 + (Math.random()-0.5)*20),
			y: typeof y === 'number' ? y : (GAME.height - 28),
			vx,
			vy,
			r,
			alive:true,
			type,
			damage
		});
	}

	// reset game to initial state
	function resetGame(){
		// restore defaults
		money = START_MONEY;
		ballPrice = START_BALL_PRICE;
		ballsOwned = 0;
		// clear active balls
		activeBalls.length = 0;
		// re-create bricks
		level = 1;
		initBricks(level);

		// reset purchased balls inventory to zero for all types
		try{
			for(const k of Object.keys(ballsByType)) delete ballsByType[k];
			for(const t of BALL_TYPES) ballsByType[t.id] = 0;
		} catch(e) { /* ignore if BALL_TYPES not available yet */ }

		// reset per-type buy prices back to their base values so the shop reflects owning none
		try{
			for(const t of BALL_TYPES) pricesByType[t.id] = t.price;
		} catch(e) { /* ignore if BALL_TYPES not available yet */ }
		// close buy menu if open
		if(buyMenu && buyMenu.classList.contains('show')){
			buyMenu.classList.remove('show');
			buyMenu.setAttribute('aria-hidden', 'true');
		}

		// ensure UI and buy menu reflect cleared ownership immediately
		try{
			updateUI();
			if(typeof renderBuyMenu === 'function' && buyMenu) renderBuyMenu();
		} catch(e) { /* ignore if UI not ready yet */ }
		// persist cleared state so reload won't restore purchased balls
		try{
			// mark that the game has been seen so we don't re-spawn defaults
			localStorage.setItem('brickbreaker-seen','1');
			saveGame();
			// also remove any old save key to avoid confusion (saveGame wrote cleared state)
			localStorage.removeItem('brickbreaker-save-legacy');
		} catch(e){}
		// reset cursor and UI
		if(canvas) canvas.style.cursor = 'default';
		updateUI();
		// draw immediately so user sees reset state
		draw();
	}

	if(resetBtn) resetBtn.addEventListener('click', resetGame);

	// allow clicking canvas to break bricks (award money). If no brick was clicked, release a test ball.
	canvas.addEventListener('click', (e) => {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		// check bricks (top-to-bottom isn't necessary but iterate normally)
		for(let i=0;i<bricks.length;i++){
			const br = bricks[i];
			if(!br.alive) continue;
			if(mx >= br.x && mx <= br.x + br.w && my >= br.y && my <= br.y + br.h){
				// clicking applies 1 damage
				applyDamageToBrick(br, 1);
				return; // stop here, do not spawn a test ball
			}
		}
		// clicked empty space — do nothing (no test ball spawn)
	});

	// change cursor when hovering over clickable bricks
	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		let over = false;
		for(const br of bricks){
			if(!br.alive) continue;
			if(mx >= br.x && mx <= br.x + br.w && my >= br.y && my <= br.y + br.h){ over = true; break; }
		}
		canvas.style.cursor = over ? 'pointer' : 'default';
	});

	function circleRectCollision(ball, rect){
		const nearestX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
		const nearestY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
		const dx = ball.x - nearestX;
		const dy = ball.y - nearestY;
		return (dx*dx + dy*dy) <= (ball.r * ball.r);
	}

	// Main loop
	// Make balls "float" by disabling gravity and using fully elastic bounces.
	const gravity = 0; // no gravity so balls float around
	const bounce = 1.0; // fully elastic collisions to preserve speed

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
						// push back to the surface and reflect velocity (no friction)
						b.y = GAME.height - b.r;
						b.vy = -b.vy * bounce;
					}

			// brick collisions
			for(let j=0;j<bricks.length;j++){
				const br = bricks[j];
				if(!br.alive) continue;
				if(circleRectCollision(b, br)){
					// determine damage from this ball
					const damage = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 1;
					// preserve ball speed but perturb direction slightly so balls keep moving
					const speed = Math.hypot(b.vx, b.vy) || 4;
					let angle = Math.atan2(b.vy, b.vx);
					angle = -angle + (Math.random() - 0.5) * 0.3;
					b.vx = Math.cos(angle) * speed;
					b.vy = Math.sin(angle) * speed;
					// apply damage (may be >1) and let helper manage awards & level progression
					applyDamageToBrick(br, damage);
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
			// use comma-separated hsl for broader canvas compatibility
			// brighter fill to contrast with dark background
			ctx.fillStyle = 'hsl(' + hue + ', 80%, 55%)';
			ctx.fillRect(br.x, br.y, br.w, br.h);
			// more visible outline
			ctx.lineWidth = 2;
			ctx.strokeStyle = 'rgba(255,255,255,0.12)';
			ctx.strokeRect(br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1);

			// draw the value on the front of the brick (centered)
			ctx.save();
			const fontSize = Math.max(10, Math.min(br.h - 6, 16));
			ctx.font = `${fontSize}px system-ui,Segoe UI,Roboto`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const text = `$${br.value}`;
			// outline for readability
			ctx.lineWidth = 2;
			ctx.strokeStyle = 'rgba(0,0,0,0.75)';
			ctx.strokeText(text, br.x + br.w/2, br.y + br.h/2);
			ctx.fillStyle = '#ffffff';
			ctx.fillText(text, br.x + br.w/2, br.y + br.h/2);
			ctx.restore();


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
	window._game = {money: ()=>money, bricks, activeBalls, save: saveGame, load: loadGame, maxActiveBalls: () => MAX_ACTIVE_BALLS};

	// Save on tab close or when the page becomes hidden. Add multiple events for reliability
	window.addEventListener('beforeunload', saveGame);
	window.addEventListener('unload', saveGame);
	window.addEventListener('pagehide', saveGame);
	document.addEventListener('visibilitychange', ()=>{ if(document.hidden) saveGame(); });

	// small keyboard shortcuts
	window.addEventListener('keydown', (e)=>{
		if(e.key === 'b') buyBall();
		if(e.key === 'r') releaseBalls();
		if(e.key === 'n') {
			// refill bricks for current level
			initBricks(level);
		}
	});

})();

