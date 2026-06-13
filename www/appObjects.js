/*
    Javascript Space Game
    By Frank Force 2021

*/

'use strict';

const weaponType_pistol  = 0;
const weaponType_shotgun = 1;
const weaponType_plasma  = 2;

const PICKUP_COLORS = [new Color(1,1,0), new Color(1,.5,0), new Color(0,1,1)];

class GameObject extends EngineObject 
{
    constructor(pos, size, tileIndex, tileSize, angle)
    {
        super(pos, size, tileIndex, tileSize, angle);
        this.isGameObject = 1;
        this.health = this.healthMax = 0;
        this.burnDelay = .1;
        this.burnTime = 3;
        this.damageTimer = new Timer;
        this.burnDelayTimer = new Timer;
        this.burnTimer = new Timer;
        this.extinguishTimer = new Timer;
        this.color = new Color;
        this.additiveColor = new Color(0,0,0,0);
    }

    inUpdateWindow() { return levelWarmup || isOverlapping(this.pos, this.size, cameraPos, updateWindowSize); }

    update()
    {
        if (this.parent || this.persistent || !this.groundObject || this.inUpdateWindow()) // pause physics if outside update window
            super.update();

        if (!this.isLavaRock)
        {
            if (!this.isDead() && this.damageTimer.isSet())
            {
                // flash white when damaged
                const a = .5*percent(this.damageTimer.get(), 0, .15);
                this.additiveColor.r = this.additiveColor.g = this.additiveColor.b = a;
                this.additiveColor.a = 0;
            }
            else
                this.additiveColor.r = this.additiveColor.g = this.additiveColor.b = this.additiveColor.a = 0;
        }
        
        if (!this.parent && this.pos.y < -1)
        {
            // kill and destroy if fall below level
            this.kill();
            this.persistent || this.destroy();
        }
        else if (this.burnTime)
        {
            if (this.burnTimer.isSet())
            {
                // burning
                if (this.burnTimer.elapsed())
                {
                    this.kill();
                    if (this.fireEmitter)
                        this.fireEmitter.emitRate = 0;
                }
                else if (rand() < .01)
                {
                    // random chance to spread fire
                    const spreadRadius = 2;
                    debugFire && debugCircle(this.pos, spreadRadius, '#f00', 1);
                    forEachObject(this.pos, spreadRadius, (o)=>o.isGameObject && o.burn());
                }
            }
            else if (this.burnDelayTimer.elapsed())
            {
                // finished waiting to burn
                this.burn(1);
            }
        }
    }
 
    render()
    {
        drawTile(this.pos, this.size, this.tileIndex, this.tileSize, this.color.scale(this.burnColorPercent(),1), this.angle, this.mirror, this.additiveColor);
    }
    
    burnColorPercent() { return lerp(this.burnTimer.getPercent(), .2, 1); }

    burn(instant)
    {
        if (!this.canBurn || this.burnTimer.isSet() || this.extinguishTimer.active())
            return;

        if (godMode && this.isPlayer)
            return;

        if (this.team == team_player)
        {
            // safety window after spawn
            if (godMode || this.getAliveTime() < 2)
                return;
        }

        if (instant)
        {
            this.burnTimer.set(this.burnTime*rand(1.5, 1));
            this.fireEmitter = makeFire();
            this.addChild(this.fireEmitter);
        }
        else
            this.burnDelayTimer.isSet() || this.burnDelayTimer.set(this.burnDelay*rand(1.5, 1));
    }

    extinguish()
    {
        if (this.fireEmitter && this.fireEmitter.emitRate == 0)
            return;

        // stop burning
        this.extinguishTimer.set(.1);
        this.burnTimer.unset();
        this.burnDelayTimer.unset();
        if (this.fireEmitter)
            this.fireEmitter.destroy();
        this.fireEmitter = 0;
    }
    
    heal(health)
    {
        assert(health >= 0);
        if (this.isDead())
            return 0;
        
        // apply healing and return amount healed
        return this.health - (this.health = min(this.health + health, this.healthMax));
    }

    damage(damage, damagingObject)
    {
        ASSERT(damage >= 0);
        if (this.isDead())
            return 0;
        
        // set damage timer;
        this.damageTimer.set();
        for(const child of this.children)
            child.damageTimer && child.damageTimer.set();

        // apply damage and kill if necessary
        const newHealth = max(this.health - damage, 0);
        if (!newHealth)
            this.kill(damagingObject);

        // set new health and return amount damaged
        return this.health - (this.health = newHealth);
    }

    isDead()                { return !this.health; }
    kill(damagingObject)    { this.destroy(); }

    collideWithObject(o)
    {
        if (o.isLavaRock && this.canBurn)
        {
            if (levelWarmup)
            {
                this.destroy();
                return 1;
            }
            this.burn();
        }
        return 1;
    }
}

///////////////////////////////////////////////////////////////////////////////

const propType_crate_wood           = 0;
const propType_crate_explosive      = 1;
const propType_crate_metal          = 2;
const propType_barrel_explosive     = 3;
const propType_barrel_water         = 4;
const propType_barrel_metal         = 5;
const propType_barrel_highExplosive = 6;
const propType_rock                 = 7;
const propType_rock_lava            = 8;
const propType_count                = 9;

class Prop extends GameObject 
{
    constructor(pos, typeOverride) 
    { 
        super(pos);

        const type = this.type = (typeOverride != undefined ? typeOverride : rand()**2*propType_count|0);
        let health = 5;
        this.tileIndex = 16;
        this.explosionSize = 0;
        if (this.type == propType_crate_wood)
        {
            this.color = new Color(1,.5,0);
            this.canBurn = 1;
        }
        else if (this.type == propType_crate_metal)
        {
            this.color = new Color(.9,.9,1);
            health = 10;
        }
        else if (this.type == propType_crate_explosive)
        {
            this.color = new Color(.2,.8,.2);
            this.canBurn = 1;
            this.explosionSize = 2;
            health = 1e3;
        }
        else if (this.type == propType_barrel_metal)
        {
            this.tileIndex = 17;
            this.color = new Color(.9,.9,1);
            health = 10;
        }
        else if (this.type == propType_barrel_explosive)
        {
            this.tileIndex = 17;
            this.color = new Color(.2,.8,.2);
            this.canBurn = 1;
            this.explosionSize = 2;
            health = 1e3;
        }
        else if (this.type == propType_barrel_highExplosive)
        {
            this.tileIndex = 17;
            this.color = new Color(1,.1,.1);
            this.canBurn = 1;
            this.explosionSize = 3;
            this.burnTimeDelay = 0;
            this.burnTime = rand(.5,.1);
            health = 1e3;
        }
        else if (this.type == propType_barrel_water)
        {
            this.tileIndex = 17;
            this.color = new Color(0,.6,1);
            health = .01;
        }
        else if (this.type == propType_rock || this.type == propType_rock_lava)
        {
            this.tileIndex = 18;
            this.color = new Color(.8,.8,.8).mutate(.2);
            health = 30;
            this.mass *= 4;
            if (rand() < .2)
            {
                health = 99;
                this.mass *= 4;
                this.size = this.size.scale(2);
                this.pos.y += .5;
            }
            this.isCrushing = 1;

            if (this.type == propType_rock_lava)
            {
                this.color = new Color(1,.9,0);
                this.additiveColor = new Color(1,0,0);
                this.isLavaRock = 1;    
            }
        }

        // randomly angle and flip axis (90 degree rotation)
        this.angle = (rand(4)|0)*PI/2;
        if (rand() < .5)
            this.size = this.size.flip();

        this.mirror = rand() < .5;
        this.health = this.healthMax = health;
        this.setCollision(1, 1);
    }
 
    update()
    {
        // Perf 8.2: skip oldVelocity capture for static (mass=0) props — they
        // never collide with anything by velocity, so the copy was pure waste.
        const oldVelocity = this.mass > 0 ? this.velocity.copy() : this.velocity;
        super.update();

        // apply collision damage
        if (this.mass > 0)
        {
            const deltaSpeedSquared = this.velocity.subtract(oldVelocity).lengthSquared();
            deltaSpeedSquared > .05 && this.damage(2*deltaSpeedSquared);
        }
    }

    damage(damage, damagingObject)
    {
        (this.explosionSize || this.type == propType_crate_wood && rand() < .1) && this.burn();
        super.damage(damage, damagingObject);
    }

    kill()
    {
        if (this.destroyed) return;

        if (this.type == propType_barrel_water)
            makeWater(this.pos);

        this.destroy();
        makeDebris(this.pos, this.color.scale(this.burnColorPercent(),1));
        
        this.explosionSize ? 
            explosion(this.pos, this.explosionSize) :
            playSound(sound_destroyTile, this.pos);
    }
}

///////////////////////////////////////////////////////////////////////////////

let checkpointPos, activeCheckpoint, checkpointTimer = new Timer;

class Checkpoint extends GameObject 
{
    constructor(pos)
    {
        super(pos.int().add(vec2(.5)))
        this.renderOrder = tileRenderOrder-1;
        this.isCheckpoint = 1;
        for(let x=3;x--;)
        for(let y=6;y--;)
            setTileCollisionData(pos.subtract(vec2(x-1,1-y)), y ? tileType_empty : tileType_solid);
    }

    update()
    {
        if (!this.inUpdateWindow())
            return; // ignore offscreen objects

        // check if player is near
        for(const player of players)
            player && !player.isDead() && this.pos.distanceSquared(player.pos) < 1 && this.setActive();
    }

    setActive()
    {
        if (activeCheckpoint != this && !levelWarmup)
            playSound(sound_checkpoint, this.pos);

        checkpointPos = this.pos;
        activeCheckpoint = this;
        checkpointTimer.set(.1);
    }

    render()
    {
        // draw flag
        const height = 4;
        const color = activeCheckpoint == this ? new Color(1,0,0) : new Color;
        const a = Math.sin(time*4+this.pos.x);
        drawTile(this.pos.add(vec2(.5,height-.3-.5-.03*a)), vec2(1,.6), 14, undefined, color, a*.06);  
        drawRect(this.pos.add(vec2(0,height/2-.5)), vec2(.1,height), new Color(.9,.9,.9));
    }
}

///////////////////////////////////////////////////////////////////////////////

class Grenade extends GameObject
{
    constructor(pos) 
    {
        super(pos, vec2(.2), 5, vec2(8));

        this.health = this.healthMax = 1e3;
        this.beepTimer = new Timer(1);
        this.alertTimer = new Timer(0); // fires immediately on first frame
        this.elasticity = .3;
        this.friction   = .9;
        this.angleDamping = .96;
        this.renderOrder = 1e8;
        this.setCollision();
    }

    update()
    {
        super.update();

        if (this.getAliveTime() > 3)
        {
            explosion(this.pos, 3);
            this.destroy();
            return;
        }

        if (this.beepTimer.elapsed())
        {
            playSound(sound_grenade, this.pos)
            this.beepTimer.set(1);
        }

        if (this.alertTimer.elapsed()) {
            alertEnemies(this.pos, this.pos);
            this.alertTimer.set(1); // throttle to once per second
        }
    }
       
    render()
    {
        drawTile(this.pos, vec2(.5), this.tileIndex, this.tileSize, this.color, this.angle);

        const a = this.getAliveTime();
        setBlendMode(1);
        drawTile(this.pos, vec2(2), 0, vec2(16), new Color(1,0,0,.2-.2*Math.cos(a*2*PI)));
        drawTile(this.pos, vec2(1), 0, vec2(16), new Color(1,0,0,.2-.2*Math.cos(a*2*PI)));
        drawTile(this.pos, vec2(.5), 0, vec2(16), new Color(1,1,1,.2-.2*Math.cos(a*2*PI)));
        setBlendMode(0);
    }
}

///////////////////////////////////////////////////////////////////////////////

class Weapon extends EngineObject 
{
    constructor(pos, parent, weaponType = weaponType_pistol) 
    { 
        super(pos, vec2(.6), 4, vec2(8));

        // weapon settings
        this.isWeapon = 1;
        this.weaponType = weaponType;
        this.fireTimeBuffer = this.localAngle = 0;
        this.recoilTimer = new Timer;

        this.addChild(this.shellEmitter = new ParticleEmitter(
            vec2(), 0, 0, 0, .1,  // pos, emitSize, emitTime, emitRate, emiteCone
            undefined, undefined, // tileIndex, tileSize
            new Color(1,.8,.5), new Color(.9,.7,.5), // colorStartA, colorStartB
            new Color(1,.8,.5), new Color(.9,.7,.5), // colorEndA, colorEndB
            3, .1, .1, .15, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
            1, .95, 1, 0, 0,    // damping, angleDamping, gravityScale, particleCone, fadeRate, 
            .1, 1              // randomness, collide, additive, randomColorLinear, renderOrder
        ));
        this.shellEmitter.elasticity = .5;
        this.shellEmitter.particleDestroyCallback = persistentParticleDestroyCallback;
        this.renderOrder = parent.renderOrder+1;

        parent.weapon = this;
        parent.addChild(this, this.localOffset = vec2(.55,0));
    }

    update()
    {
        super.update();

        // weapon stats: [fireRate, bulletCount, spread, bulletSpeed, bulletRange]
        const wpnStats = [
            [0.25, 1,  0.05, 0.5, 20],  // pistol
            [0.5,  5,  0.2,  0.4, 12],  // shotgun
            [0.15, 1,  0.02, 0.8, 30],  // plasma
        ];
        const stats = wpnStats[this.weaponType] || wpnStats[0];
        const [fireInterval, bulletCount, spread, bulletSpeed, bulletRange] = stats;

        this.mirror = this.parent.mirror;
        this.fireTimeBuffer += timeDelta;

        if (this.recoilTimer.active())
            this.localAngle = lerp(this.recoilTimer.getPercent(), 0, this.localAngle);

        if (this.triggerIsDown)
        {
            // slow down enemy bullets
            const speed = bulletSpeed * (this.parent.isPlayer ? 1 : .5);
            for(; this.fireTimeBuffer > 0; this.fireTimeBuffer -= fireInterval)
            {
                this.localAngle = -rand(.2,.15);
                this.recoilTimer.set(rand(.4,.3));

                for (let i = 0; i < bulletCount; ++i)
                {
                    const bullet = new Bullet(this.pos, this.parent);
                    const direction = vec2(this.getMirrorSign(speed), 0);
                    bullet.velocity = direction.rotate(rand(spread,-spread));
                    bullet.range = bulletRange;
                    bullet.weaponType = this.weaponType;
                }

                // IMPROVEMENT 5.1: tally bullets fired by the player. Per
                // bullet so shotgun pellets each count individually.
                if (this.parent.isPlayer)
                    weaponStats[this.weaponType].fired += bulletCount;

                this.shellEmitter.localAngle = -.8*this.getMirrorSign();
                this.shellEmitter.emitParticle();
                playSound(sound_shoot, this.pos);

                // alert enemies
                this.parent.isPlayer && alertEnemies(this.pos, this.pos);
            }
        }
        else
            this.fireTimeBuffer = min(this.fireTimeBuffer, 0);
    }
}

///////////////////////////////////////////////////////////////////////////////

class Bullet extends EngineObject 
{
    constructor(pos, attacker) 
    { 
        super(pos, vec2(.25));  // nonzero size so forEachObject overlaps register on BonusBox
        this.color = new Color(1,1,0,1);
        this.lastVelocity = this.velocity;
        this.setCollision(0, 0, 1); // tile collision only — no object-vs-object physics (Fix 7)

        this.damage = this.damping = 1;
        this.gravityScale = 0;
        this.attacker = attacker;
        this.team = attacker.team;
        this.renderOrder = 1e9;
        this.range = 8;
    }

    update()
    {
        this.lastVelocity = this.velocity;
        super.update();

        this.range -= this.velocity.length();
        if (this.range < 0)
        {
            const emitter = new ParticleEmitter(
                this.pos, .2, .1, 100, PI, // pos, emitSize, emitTime, emitRate, emiteCone
                0, undefined,     // tileIndex, tileSize
                new Color(1,1,0,.5), new Color(1,1,1,.5), // colorStartA, colorStartB
                new Color(1,1,0,0), new Color(1,1,1,0), // colorEndA, colorEndB
                .1, .5, .1, .1, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
                1, 1, .5, PI, .1,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
                .5, 0, 1           // randomness, collide, additive, randomColorLinear, renderOrder
            );

            this.destroy();
            return;
        }

        // check if hit someone (throttled: scan every other frame to halve cost)
        if (frame % 2 === 0)
        forEachObject(this.pos, this.size, (o)=>
        {
            if (o.isGameObject && !o.parent && o.team != this.team)
            if (!o.dodgeTimer || !o.dodgeTimer.active())
                this.collideWithObject(o)
        });
    }
    
    collideWithObject(o)
    {
        // BonusBox has no health system — delegate entirely to its own handler.
        if (o.isBonusBox)
        {
            o.collideWithObject(this);
            this.kill();
            return 1;
        }

        if (o.isGameObject)
        {
            o.damage(this.damage, this);
            o.applyForce(this.velocity.scale(.1));

            // IMPROVEMENT 3.1: 4-particle hit-spark at the impact point.
            // 0.12s lifetime → max ~16 particles in flight even in heavy combat.
            new ParticleEmitter(
                this.pos, 0, .12, 4, PI,
                0, undefined,
                new Color(1,1,.6), new Color(1,.5,.2),
                new Color(1,1,.6,0), new Color(1,.5,.2,0),
                .12, .15, 0, .1, .1,
                1, 1, 0, PI, 0,
                .5, 0, 1
            );

            // IMPROVEMENT 5.1: tally hits and damage for the player's weapon.
            if (this.attacker && this.attacker.isPlayer && this.weaponType !== undefined)
            {
                weaponStats[this.weaponType].hits += 1;
                weaponStats[this.weaponType].damage += this.damage;
            }

            if (o.isCharacter)
            {
                playSound(sound_walk, this.pos);
                this.destroy();
            }
            else
                this.kill();
        }

        return 1;
    }

    collideWithTile(data, pos)
    {
        if (data <= 0)
            return 0;
            
        const destroyTileChance = data == tileType_glass ? 1 : data == tileType_dirt ? .2 : .05;
        rand() < destroyTileChance && destroyTile(pos);
        this.kill();

        return 1; 
    }

    kill()
    {
        if (this.destroyed)
            return;

        const emitter = new ParticleEmitter(
            this.pos, 0, .1, 100, .5, // pos, emitSize, emitTime, emitRate, emiteCone
            undefined, undefined,     // tileIndex, tileSize
            new Color(1,1,0), new Color(1,0,0), // colorStartA, colorStartB
            new Color(1,1,0), new Color(1,0,0), // colorEndA, colorEndB
            .2, .2, 0, .1, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
            1, 1, .5, PI, .1,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
            .5, 1, 1           // randomness, collide, additive, randomColorLinear, renderOrder
        );
        emitter.trailScale = 1;
        emitter.angle = this.lastVelocity.angle() + PI;
        emitter.elasticity = .3;

        this.destroy();
    }

    render()
    {
        drawRect(this.pos, vec2(.4,.5), new Color(1,1,1,.5), this.velocity.angle());
        drawRect(this.pos, vec2(.2,.5), this.color, this.velocity.angle());
    }
}

///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////

class BonusBox extends GameObject {
    constructor(pos, color)
    {
        super(pos, vec2(1));
        // isGameObject is set by GameObject constructor — no need to repeat it here
        this.team         = team_none;   // neutral — player bullets (team_player != team_none) hit it
        this.isBonusBox   = 1;
        this.bobTimer     = 0;
        this.spawnPos     = pos.copy();
        this.gravityScale = 0;
        this.boxColor     = color || new Color(1, .8, 0);
        this.renderOrder  = 1e8;
        this.setCollision(1, 0);        // collidable (so forEachObject finds it) but not solid (no physics blocking)
        // IMPROVEMENT 1.3: publish a reference so the HUD can draw an off-screen
        // direction arrow at the screen edge when the box is far away.
        bonusBoxRef = this;
    }

    // Called by Bullet.collideWithObject when a bullet overlaps this box.
    // Only accept hits from player-team bullets.
    collideWithObject(o)
    {
        if (!o || o.team !== team_player)
            return 0; // reject — enemy fire, physics contacts, etc.

        if (this.destroyed || levelEndTimer.isSet())
            return 1;

        // IMPROVEMENT 1.1: the BonusBox is now the level finale, not the only
        // objective. Players must clear all enemies first; shooting the box
        // early plays a "locked" buzz and the box survives.
        if (typeof areaClear !== 'undefined' && !areaClear)
        {
            playSound(sound_box_locked, this.spawnPos);
            return 0;
        }

        playSound(sound_bonusbox, this.spawnPos);

        // celebratory burst — minimized to keep memory/CPU low (was 80 particles).
        new ParticleEmitter(
            this.spawnPos, 1.2, .15, lowGraphicsSettings ? 10 : 18, PI,
            0, undefined,
            this.boxColor, new Color(1,1,1,.8),
            this.boxColor.scale(1,.5), new Color(1,1,0,0),
            .5, .35, .05, .25, .2,
            .95, .8, .2, PI, .3,
            .5, 0, 1
        );

        // IMPROVEMENT 5.4: count broken boxes for the "Boxed Up" achievement.
        bonusBoxBreakCount += 1;
        if (bonusBoxBreakCount >= 10)
            unlockAchievement('boxed_10', 'Boxed Up');

        levelEndTimer.set();
        if (bonusBoxRef === this)
            bonusBoxRef = null;
        this.destroy();
        return 1;
    }

    update()
    {
        super.update();
        this.bobTimer += 1 / 60;
        // Perf 8.6: write bob directly to this.pos — avoids 2 Vector2 allocs/frame
        // from `spawnPos.add(vec2(...))`. spawnPos is the stable reference, the
        // additive stays in pos.x/pos.y and is recomputed from the timer each tick.
        this.pos.x = this.spawnPos.x;
        this.pos.y = this.spawnPos.y + Math.sin(this.bobTimer * 4) * .3;
    }

    render()
    {
        const pulse  = .4 + .3 * Math.sin(this.bobTimer * 3);
        const pos    = this.pos;
        const c      = this.boxColor;

        // additive glow beacon underneath
        setBlendMode(1);
        drawRect(pos, vec2(2.2), c.scale(1, pulse * .6));
        drawRect(pos, vec2(1.6), c.scale(1, pulse));
        setBlendMode(0);

        // solid box body (no rotation)
        drawRect(pos, vec2(1),   c);
        drawRect(pos, vec2(.85), c.scale(.6));

        // bright cross / star marker on face
        drawRect(pos, vec2(.55, .12), new Color(1,1,1,.9));
        drawRect(pos, vec2(.12, .55), new Color(1,1,1,.9));
    }
}

///////////////////////////////////////////////////////////////////////////////

class WeaponPickup extends EngineObject {
    constructor(pos, pickupType = weaponType_pistol) {
        super(pos, vec2(0)); // no sprite — drawn in render()
        this.pickupType = pickupType;
        this.bobTimer = 0;
        this.spawnPos = pos.copy(); // fixed reference — bob offsets from here, no drift
        this.gravityScale = 0;
        this.setCollision(0, 0);
    }
    update() {
        super.update();
        this.bobTimer += 0.04;

        // collect on player proximity
        const p = players && players[0];
        if (p && !p.isDead() && p.pos.distance(this.spawnPos) < 2) {
            if (p.weapon)
                p.weapon.weaponType = this.pickupType;
            playSound(sound_jump, this.spawnPos);
            this.destroy();
        }
    }
    render() {
        // colors: orange=shotgun, cyan=plasma (module-scope PICKUP_COLORS — no per-frame alloc)
        const c = PICKUP_COLORS[this.pickupType] || PICKUP_COLORS[0];

        // bob purely as offset from spawn — no positional drift
        const bobY = Math.sin(this.bobTimer) * 0.2;
        const pos  = this.spawnPos.add(vec2(0, bobY));

        // pulsing outer glow (additive blend)
        const pulse = .4 + .3 * Math.sin(this.bobTimer * 2);
        setBlendMode(1);
        drawRect(pos, vec2(1.4), c.scale(1, pulse));
        setBlendMode(0);

        // solid inner body
        drawRect(pos, vec2(.7), c);

        // weapon-type marker above
        if (this.pickupType === weaponType_shotgun) {
            drawRect(pos.add(vec2(-.2, .7)), vec2(.18, .25), c); // twin barrels
            drawRect(pos.add(vec2( .2, .7)), vec2(.18, .25), c);
        } else {
            drawRect(pos.add(vec2(0, .75)), vec2(.15, .4), c);   // tall spike = plasma
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
// IMPROVEMENT 1.2: COLLECT objective — a small "stash" the player picks up
// by walking into it. Bounded count per level (typically 3). On pickup
// the global stashesCollected counter increments, and the areaClear
// condition in app.js unlocks the BonusBox once the tally is met.

class Stash extends GameObject {
    constructor(pos)
    {
        super(pos, vec2(.5));
        this.isStash     = 1;
        this.gravityScale = 0;
        this.bobTimer    = 0;
        this.spawnPos    = pos.copy();
        this.color       = new Color(.3, .6, 1);   // blue
        this.renderOrder = 1e7;
        this.setCollision(0, 0);                    // no physics, just proximity
    }

    update()
    {
        super.update();
        this.bobTimer += 1 / 60;
        // collect on player proximity
        const p = players && players[0];
        if (p && !p.isDead() && p.pos.distance(this.spawnPos) < 1)
        {
            stashesCollected += 1;
            playSound(sound_jump, this.spawnPos);
            // 12-particle cyan burst — bounded, no GC pressure
            new ParticleEmitter(
                this.spawnPos, .8, .2, 12, PI,
                0, undefined,
                new Color(.4, .8, 1), new Color(.2, .5, 1),
                new Color(.4, .8, 1, 0), new Color(.2, .5, 1, 0),
                .4, .3, 0, .15, .15,
                1, 1, 0, PI, 0,
                .5, 0, 1
            );
            this.destroy();
        }
    }

    render()
    {
        // pulsing cyan diamond floating above the ground
        const pulse = .5 + .5 * Math.sin(this.bobTimer * 3);
        const pos = vec2(this.spawnPos.x, this.spawnPos.y + Math.sin(this.bobTimer * 4) * .25);
        setBlendMode(1);
        drawRect(pos, vec2(.55 * (1 + pulse * .2)), this.color.scale(1, .5 + pulse * .5));
        setBlendMode(0);
        drawRect(pos, vec2(.35, .35), this.color);
    }
}