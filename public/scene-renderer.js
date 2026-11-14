import * as THREE from './vendor/three.module.js';

export function createLibraryScene(stage, onSelect, onFailure) {
 const lab = stage.closest('.library-lab');
 const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
 renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
 renderer.setClearColor(0x0b1018, 0);
 renderer.outputColorSpace = THREE.SRGBColorSpace;
 stage.prepend(renderer.domElement);
 stage.classList.add('has-webgl');
 const scene = new THREE.Scene();
 const camera = new THREE.OrthographicCamera(-4.8, 4.8, 3, -3, .1, 50);
 camera.position.set(0, 2.6, 13);
 camera.lookAt(0, 0, 0);
 const world = new THREE.Group(); scene.add(world);
 scene.add(new THREE.HemisphereLight(0xc7dcf6, 0x121a24, 2));
 const light = new THREE.DirectionalLight(0xffd7a5, 3.2);light.position.set(-3,6,5);scene.add(light);
 const fill = new THREE.DirectionalLight(0x8aa8c9, 1.2);fill.position.set(4,2,-2);scene.add(fill);
 const navy = new THREE.MeshStandardMaterial({color:0x1c3045,roughness:.92,metalness:.05});
 const pages = new THREE.MeshStandardMaterial({color:0x8a958f,roughness:1});
 const shelfMat = new THREE.MeshStandardMaterial({color:0x223246,roughness:.95});
 const amber = new THREE.LineBasicMaterial({color:0xffbe70,transparent:true,opacity:.8});
 const mutedEdge = new THREE.LineBasicMaterial({color:0x62778b,transparent:true,opacity:.55});
 const unitBox = new THREE.BoxGeometry(1,1,1);
 const unitEdges = new THREE.EdgesGeometry(unitBox);
 const objects = {};
 const narrow = () => matchMedia('(max-width: 450px)').matches;
 const vector = coordinates => new THREE.Vector3(...coordinates);
 const story = { query:[0,1.9,.1], key0:[-2.35,.9,.5],key1:[0,.65,.1],key2:[2.35,.9,.5],value0:[-2.35,-1.15,1.1],value1:[0,-1.4,.9],value2:[2.35,-1.15,1.1],scores:[-.8,0,0],weights:[.7,0,0],output:[3.8,0,0] };
 const mechanism = { query:[-3.8,0,0],key0:[-2.25,1.45,0],key1:[-2.25,0,0],key2:[-2.25,-1.45,0],scores:[-.8,0,0],weights:[.7,0,0],value0:[2.25,1.45,0],value1:[2.25,0,0],value2:[2.25,-1.45,0],output:[3.8,0,0] };
 const mobileMechanism = { query:[0,3.5,0],key0:[-2.6,2,0],key1:[0,2,0],key2:[2.6,2,0],scores:[-1.3,.25,0],weights:[1.3,.25,0],value0:[-2.6,-1.5,0],value1:[0,-1.5,0],value2:[2.6,-1.5,0],output:[0,-3.2,0] };
 function card(name) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(unitBox, navy);mesh.scale.set(name==='query'?1.8:1.35,.68,.12);group.add(mesh);
  const outline = new THREE.LineSegments(unitEdges, name==='query'?amber:mutedEdge);outline.scale.copy(mesh.scale);group.add(outline);
  group.position.copy(vector(story[name]));world.add(group);objects[name]=group;return group;
 }
 for (const name of Object.keys(story)) card(name);
 const furniture = new THREE.Group();world.add(furniture);
 function shelf(y,z) {
  const points = Array.from({length:21},(_,i)=>{const x=(i-10)*.34;return new THREE.Vector3(x,y+.07*x*x,z+.1*x*x)});
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),40,.07,6,false),shelfMat);furniture.add(mesh);return mesh;
 }
 shelf(-.95,-.35);shelf(-1.65,-.65);const upperShelf=shelf(.9,-1.3);const backgroundBooks=new THREE.Group();furniture.add(backgroundBooks);
 // A measured arc of background spines, not random floating objects.
 for(let i=0;i<14;i++) {
  const x=(i-6.5)*.44;
  const book=new THREE.Mesh(unitBox,shelfMat);book.scale.set(.25,.65+(i%3)*.12,.26);book.position.set(x,1.24+.07*x*x,-1.3+.1*x*x);book.rotation.y=-x*.12;backgroundBooks.add(book);
 }
 const bookGroups=[];
 for(let i=0;i<3;i++) {
  const group=new THREE.Group();const x=(i-1)*2.35;
  group.position.set(x,-.2+(i===1?-.24:0),.15+Math.abs(i-1)*.6);group.rotation.y=-(i-1)*.28;group.rotation.z=-(i-1)*.09;
  const cover=new THREE.Mesh(unitBox,navy);cover.scale.set(.8,1.55,.55);group.add(cover);
  const block=new THREE.Mesh(unitBox,pages);block.scale.set(.62,1.37,.52);block.position.x=.06;group.add(block);
  for(const y of [-.48,.48]){const band=new THREE.Mesh(unitBox,new THREE.MeshStandardMaterial({color:0xa17e51,roughness:.8}));band.scale.set(.82,.025,.57);band.position.y=y;group.add(band)}
  const edge=new THREE.LineSegments(unitEdges,amber);edge.scale.copy(cover.scale);group.add(edge);
  group.userData.book=i;furniture.add(group);bookGroups.push(group);
 }
 const paths = new THREE.Group();world.add(paths);
 const linePool=Array.from({length:13},()=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(25*3),3));const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xc9975f,transparent:true,opacity:.5}));paths.add(line);return line});
 const labels=[...stage.querySelectorAll('[data-node]')];
 let state={mode:'story',book:0,paused:false,reduced:false};
 let progress=0,target=0,visible=true,failed=false,raf=0,frames=0;
 const pointer={x:0,y:0}, rotation={x:0,y:0};
 let last=0;
 function canMove(){return !state.paused&&!state.reduced;}
 function schedule(){if(!failed&&visible&&!document.hidden&&!raf)raf=requestAnimationFrame(frame);}
 function resize(){const {width,height}=stage.getBoundingClientRect();if(!width||!height)return;backgroundBooks.visible=width>450;upperShelf.visible=width>450;renderer.setPixelRatio(Math.min(devicePixelRatio||1,width>450?1.5:1.25));const span=narrow()&&state.mode==='mechanism'?4.2:4.8;camera.left=-span;camera.right=span;camera.top=span*height/width;camera.bottom=-camera.top;camera.updateProjectionMatrix();renderer.setSize(width,height,false);schedule();}
 const observer=new ResizeObserver(resize);observer.observe(stage);
 const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible){cancelAnimationFrame(raf);raf=0;lab.dataset.sceneState='suspended'}else schedule()},{threshold:0});intersection.observe(stage);
 function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0;lab.dataset.sceneState='suspended'}else schedule();}
 document.addEventListener('visibilitychange',visibility);
 function route(line,start,end){
  const attribute=line.geometry.attributes.position;
  const a=start.clone(),b=end.clone();a.z-=.08;b.z-=.08;
  const curve=new THREE.CubicBezierCurve3(a,a.clone().lerp(b,.32).add(new THREE.Vector3(0,.08,0)),a.clone().lerp(b,.68).add(new THREE.Vector3(0,.08,0)),b);
  for(let i=0;i<25;i++){const p=curve.getPoint(i/24);attribute.setXYZ(i,p.x,p.y,p.z)}
  attribute.needsUpdate=true;line.geometry.computeBoundingSphere();
 }
 function frame(time){
  raf=0;if(failed||!visible||document.hidden)return;
  const dt=Math.min((time-last)/1000||.016,.04);last=time;
  const moving=canMove();
  if(!moving){progress=target;rotation.x=0;rotation.y=0}else{
   progress=THREE.MathUtils.damp(progress,target,7,dt);
   if(Math.abs(progress-target)<.001)progress=target;
   rotation.x=THREE.MathUtils.damp(rotation.x,pointer.y*.025,7,dt);rotation.y=THREE.MathUtils.damp(rotation.y,pointer.x*.04,7,dt);
  }
  world.rotation.set(rotation.x,rotation.y,0);
  for(const [name,object] of Object.entries(objects)){
   object.position.lerpVectors(vector(story[name]),vector(narrow()?mobileMechanism[name]:mechanism[name]),progress);
   object.rotation.y=(1-progress)*(name==='query'?-.12:.08);
   object.scale.setScalar(1-progress*.32);
   object.visible=!['scores','weights','output'].includes(name)||progress>.4;
   if(name.startsWith('key')&&progress<.1)object.visible=Number(name.at(-1))===state.book;
  }
  furniture.visible=progress<.98;
  furniture.scale.setScalar(1-progress*.3);furniture.position.z=-progress*2;
  bookGroups.forEach((book,i)=>book.scale.setScalar(i===state.book?1.07:1));
  const edges=progress>.5?
   [['query','key0'],['query','key1'],['query','key2'],['key0','scores'],['key1','scores'],['key2','scores'],['scores','weights'],['weights','value0'],['weights','value1'],['weights','value2'],['value0','output'],['value1','output'],['value2','output']]:
   [['query',`key${state.book}`],[`key${state.book}`,`value${state.book}`]];
  linePool.forEach((line,i)=>{line.visible=i<edges.length;if(line.visible)route(line,objects[edges[i][0]].position,objects[edges[i][1]].position)});
  world.updateMatrixWorld(true);
  for(const label of labels){const position=objects[label.dataset.node].getWorldPosition(new THREE.Vector3()).project(camera);label.style.left=`${(position.x+1)*50}%`;label.style.top=`${(1-position.y)*50}%`;}
  try{renderer.render(scene,camera)}catch(error){fail();return}
  lab.dataset.sceneFrames=String(++frames);
  const unsettled=progress!==target||Math.abs(rotation.x-pointer.y*.025)>.0001||Math.abs(rotation.y-pointer.x*.04)>.0001;
  lab.dataset.sceneState=moving&&unsettled?'running':'idle';
  if(moving&&unsettled)schedule();
 }
 stage.addEventListener('pointermove',event=>{if(event.pointerType!=='mouse'||!matchMedia('(hover: hover)').matches||!canMove())return;const r=stage.getBoundingClientRect();pointer.x=(event.clientX-r.left)/r.width-.5;pointer.y=(event.clientY-r.top)/r.height-.5;schedule();});
 stage.addEventListener('pointerleave',()=>{pointer.x=pointer.y=0;schedule();});
 const raycaster=new THREE.Raycaster();let down;
 stage.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});
 stage.addEventListener('pointerup',e=>{
  if(state.mode!=='story'||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>8)return;
  const r=stage.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
  const hit=raycaster.intersectObjects(bookGroups,true)[0];if(hit){let object=hit.object;while(object&&object.userData.book===undefined)object=object.parent;if(object)onSelect(object.userData.book)}
 });
 function fail(){if(failed)return;failed=true;cancelAnimationFrame(raf);observer.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);renderer.domElement.remove();onFailure();}
 renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();fail()});
 resize();
 return {update(next){state={...next};target=state.mode==='mechanism'?1:0;if(!canMove()){progress=target;pointer.x=pointer.y=0}lab.dataset.sceneState=visible&&!document.hidden?'running':'suspended';resize();schedule();},dispose(){fail();scene.traverse(object=>{if(object.geometry&&object.geometry!==unitBox&&object.geometry!==unitEdges)object.geometry.dispose()});unitBox.dispose();unitEdges.dispose();renderer.dispose();}};
}
