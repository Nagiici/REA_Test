/** Continuous capsule movement for the browser adapter, not a PhysX clone.
 * Sweep the combined displacement, then slide the remaining motion along the
 * contacted face. Trigger classification remains separate and source-derived. */
import { CLASSIC_CONTROLLER, controllerCapsule, controllerSolid } from './classic-controller.js';
import { capsuleEntitySeparation } from './classic-contact.js';
import { trainBodyAt } from './classic-train-body.js';
const EPS=1e-7;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

// Native moving proxies/children advance with player progress; externally
// timed motion uses the fraction of this fixed tick instead. Do not confuse
// either with an unmoving box at its end-of-tick position.
export function controllerBodyAt(e, position, time=1) {
 if(e.movingTrainProxy)return trainBodyAt(e,position[2]);
 if(e.movingTrain&&!e.trainAutopilot)return {...e,distance:e.movingTrain.initialDistance-(position[2]-e.movingTrain.referencePlayerDistance)*e.movingTrain.ratio};
 if(e.previousDistance!=null&&e.previousDistance!==e.distance)return {...e,distance:e.previousDistance+(e.distance-e.previousDistance)*time};
 return e;
}

export function moveControllerSwept(previous,target,rolling,entities,{ground=-Infinity}={}) {
 const height=rolling?CLASSIC_CONTROLLER.rollingHeight:CLASSIC_CONTROLLER.standingHeight;
 const pad=Math.hypot(...target.map((v,i)=>v-previous[i]))+CLASSIC_CONTROLLER.radius+.01;
 // Legacy demo ramps are height fields, not boxes; real routes carry exact shapes.
 const candidates=entities.filter(e=>controllerSolid(e)&&(e.type!=='ramp'||e.sourceShape)).filter(e=>{
  const a=controllerBodyAt(e,previous,0),b=controllerBodyAt(e,target,1);
  return Math.max(previous[0],target[0])+pad>=e.x-e.width/2&&Math.min(previous[0],target[0])-pad<=e.x+e.width/2
   &&Math.max(previous[1],target[1])+height+pad>=(e.bottom??0)&&Math.min(previous[1],target[1])-pad<=e.height
   &&Math.max(previous[2],target[2])+pad>=Math.min(a.distance,b.distance)-e.depth/2*(e.movingTrainProxy?1+e.movingTrainProxy.ratio:1)
   &&Math.min(previous[2],target[2])-pad<=Math.max(a.distance,b.distance)+e.depth/2*(e.movingTrainProxy?1+e.movingTrainProxy.ratio:1);
 });
 const separation=(e,p,t)=>capsuleEntitySeparation(controllerCapsule(p,rolling),controllerBodyAt(e,p,t));
 const gradient=(e,p,t)=>p.map((v,i)=>{
  const a=[...p],b=[...p];a[i]+=1e-5;b[i]-=1e-5;
  return (separation(e,a,t)-separation(e,b,t))/2e-5;
 });
 let position=[...previous],end=[...target],time=0;const contacts=[];
 // Restoring a standing capsule can begin slightly inside a surface. Permit
 // only bounded recovery; impossible cramped configurations remain reported.
 for(let pass=0;pass<4;pass++){
  let changed=false;
  for(const e of candidates){const d=separation(e,position,time);if(d>=-EPS)continue;
   const n=gradient(e,position,time),nn=dot(n,n);if(nn<1e-10)continue;
   const correction=Math.min(.35,-d+EPS)/nn;
   position=position.map((v,i)=>v+n[i]*correction);position[1]=Math.max(ground,position[1]);changed=true;
  }if(!changed)break;
 }
 for(let pass=0;pass<8;pass++){
  let first=null;
  for(const e of candidates){
   const at=t=>mix(position,end,t),clock=t=>time+(1-time)*t;
   const d=t=>separation(e,at(t),clock(t));
   let lo=0,hi=1;
   for(let i=0;i<24;i++){const a=(lo*2+hi)/3,b=(lo+hi*2)/3;if(d(a)<d(b))hi=b;else lo=a;}
   const minimum=(lo+hi)/2;
   if(d(minimum)>=-EPS&&d(1)>=-EPS)continue;
   lo=0;hi=d(1)<-EPS?1:minimum;
   for(let i=0;i<28;i++){const m=(lo+hi)/2;if(d(m)<0)hi=m;else lo=m;}
   if(!first||lo<first.fraction)first={entity:e,fraction:lo};
  }
  if(!first){position=end;time=1;break;}
  const e=first.entity;position=mix(position,end,first.fraction);time+=(1-time)*first.fraction;
  const n=gradient(e,position,time),nn=dot(n,n);if(nn<1e-10)break;
  contacts.push({id:e.id,normal:n.map(v=>v/Math.sqrt(nn))});
  const delta=end.map((v,i)=>v-position[i]);
  const h=Math.min(1e-4,1-time),moving=h>0?(separation(e,position,time+h)-separation(e,position,time))/h:0;
  const inward=dot(n,delta)+moving*(1-time);
  if(inward<0)end=end.map((v,i)=>v-n[i]*inward/nn);
  // Small numerical separation keeps a tangent from repeatedly consuming the
  // same sweep. This is not a gameplay-sized inflation of the collision box.
  position=position.map((v,i)=>v+n[i]*EPS/nn);
 }
 // Do not escape an impossible low ceiling through the solid ground.
 position[1]=Math.max(ground,position[1]);
 const overlaps=candidates.filter(e=>separation(e,position,1)<-1e-5).map(e=>e.id);
 return {position,contacts,overlaps};
}
