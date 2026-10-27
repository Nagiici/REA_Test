/** Bounded vertical CharacterController adapter. Source dimensions and probe
 * order are recovered; vertical convex sweeps are our solver, not PhysX.
 * Trigger contacts remain in classic-contact.js with their distinct .3 radius. */
import { capsuleEntitySeparation } from './classic-contact.js';
export const CLASSIC_CONTROLLER = Object.freeze({ radius:.2, standingHeight:.9,
  rollingHeight:.4, expansionMove:.2, slopeLimit:70, skinWidth:.020000000298,
  stepOffset:.3 });
const EPS=1e-8, radius=CLASSIC_CONTROLLER.radius;
const walkableY=Math.cos(CLASSIC_CONTROLLER.slopeLimit*Math.PI/180);
export function controllerSolid(e) {
  return !e.collisionDisabled && e.sourceIsTrigger!==true && e.sourceTag!=='Ground'
    && (['train','ramp','obstacle','barrier','overhead'].includes(e.type)||e.walkable===true);
}
export function controllerCapsule(position, rolling=false) {
  const height=rolling?CLASSIC_CONTROLLER.rollingHeight:CLASSIC_CONTROLLER.standingHeight;
  return {a:[position[0],position[1]+radius,position[2]],
    b:[position[0],position[1]+height-radius,position[2]],radius};
}

/** Vertical forbidden interval for the foot sphere. Convex distance in Y has
 * one minimum; bracket both roots rather than inflate the obstacle's AABB.
 * Minkowski-extension by the capsule segment supplies the full-body interval. */
export function controllerInterval(entity,x,z,rolling=false) {
  if (!controllerSolid(entity)||Math.abs(x-entity.x)>entity.width/2+radius
    ||Math.abs(z-entity.distance)>entity.depth/2+radius) return null;
  const separation=(y,px=x,pz=z)=>{const center=[px,y+radius,pz];return capsuleEntitySeparation({a:center,b:center,radius},entity);};
  let low=(entity.bottom??0)-2*radius-EPS,high=entity.height+EPS;
  let a=low,b=high;
  for(let i=0;i<40;i++){const l=(2*a+b)/3,r=(a+2*b)/3;if(separation(l)<separation(r))b=r;else a=l;}
  const minimum=(a+b)/2;
  // Pure tangent contact has no vertical supporting extent.
  if(separation(minimum)>=-EPS)return null;
  a=low;b=minimum;
  for(let i=0;i<36;i++){const m=(a+b)/2;if(separation(m)>0)a=m;else b=m;}
  const bottom=(a+b)/2;
  a=minimum;b=high;
  for(let i=0;i<36;i++){const m=(a+b)/2;if(separation(m)>0)b=m;else a=m;}
  const rawTop=(a+b)/2,top=Math.abs(rawTop-entity.height)<EPS?entity.height:rawTop,h=1e-5;
  const gradient=[separation(top,x+h,z)-separation(top,x-h,z),
    separation(top+h)-separation(top-h),separation(top,x,z+h)-separation(top,x,z-h)];
  const length=Math.hypot(...gradient),normal=length>EPS?gradient.map(v=>v/length):[0,1,0];
  const height=rolling?CLASSIC_CONTROLLER.rollingHeight:CLASSIC_CONTROLLER.standingHeight;
  return {min:bottom-(height-2*radius),max:top,normal,walkable:normal[1]>=walkableY};
}

/** A single vertical Move. Starting overlaps may move toward their closest
 * exit; new contacts stop at the first boundary. No lateral depenetration or
 * arbitrary skin inflation. Residual overlaps are reported, never hidden by
 * shrinking the standing capsule or delaying EndRoll. */
export function moveControllerVertical(position,dy,rolling,entities,{ground=0}={}) {
  const intervals=entities.map(entity=>({entity,interval:controllerInterval(entity,position[0],position[2],rolling)})).filter(v=>v.interval);
  const start=position[1];let y=start+dy,below=false,above=false;
  if(dy<0&&start>=ground-EPS&&y<=ground){y=ground;below=true;}
  for(const {interval:q} of intervals){
    if(dy<0&&start>=q.max-EPS&&y<q.max){y=q.max;below=q.walkable;}
    else if(dy>0&&start<=q.min+EPS&&y>q.min){y=q.min;above=true;}
    else if(start>q.min+EPS&&start<q.max-EPS){
      const towardsLower=start-q.min<=q.max-start;
      // A size restoration can overlap a low ceiling. Permit a downward
      // exit there, but never sweep deeper through the opposite face.
      if(dy>0&&towardsLower){y=Math.min(y,start);above=true;}
      if(dy<0&&!towardsLower){y=Math.max(y,start);below=false;}
    }
  }
  const overlaps=intervals.filter(({interval:q})=>y>q.min+1e-7&&y<q.max-1e-7).map(v=>v.entity.id);
  return {position:[position[0],y,position[2]],below,above,overlaps};
}

/** ExpandColliders81820: Move(up*2), remove squeeze, Move(down*2), cache.
 * Each Move independently uses controller.enabled; collision detection is a
 * different switch (e.g. the controller stays enabled during Jetpack). */
export function expandController(position,squeezed,entities,options={}) {
  const trace=[];let current=[...position],result={below:false,above:false,overlaps:[]};
  for(const [name,dy] of [['up',CLASSIC_CONTROLLER.expansionMove],['down',-CLASSIC_CONTROLLER.expansionMove]]){
    if(name==='down')squeezed=options.removeSqueeze?.()??false;
    const rolling=squeezed;
    const enabled=typeof options.enabled==='function'?options.enabled(name):options.enabled!==false;
    const from=[...current];
    if(enabled){result=moveControllerVertical(current,dy,rolling,entities,options);current=result.position;}
    trace.push({move:name,enabled,rolling,from,to:[...current]});
  }
  return {...result,position:current,trace,squeezed};
}
