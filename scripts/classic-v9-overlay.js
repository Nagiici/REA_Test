import * as THREE from 'three';
// Created in the renderer's realm: Three checks typed-array constructors.
window.makeControllerFixture = e => {
 const group=new THREE.Group(),geometry=new THREE.BoxGeometry(e.width,e.height-(e.bottom??0),e.depth);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x67e4d6,transparent:true,opacity:.15,depthWrite:false}));
 mesh.position.y=((e.bottom??0)+e.height)/2;group.add(mesh);
 const lines=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0x67e4d6}));lines.position.y=mesh.position.y;group.add(lines);
 window.__runner.scene.add(group);return group;
};
