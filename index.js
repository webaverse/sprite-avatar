import * as THREE from 'three';
// import easing from './easing.js';
import metaversefile from 'metaversefile';
const {useApp, useFrame, usePhysics, createAvatar, useAvatarAnimations, useInternals, useCleanup} = metaversefile;

// const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

const size = 4096;
const texSize = 512;
// const numFrames = 7;
const numFrames = 20;
const numAngles = 8;
const worldSize = 2;
const distance = 2;
const speed = 10;
const numSlots = size / texSize;

console.log('sprite avatar index');

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localEuler = new THREE.Euler();
const localMatrix = new THREE.Matrix4();

function mod(a, n) {
  return ((a % n) + n) % n;
}
const _timeout = (t = 1000) => new Promise((accept, reject) => {
  setTimeout(accept, t);
});

class CameraGeometry extends THREE.BufferGeometry {
  constructor() {
    super();

    const boxGeometry = new THREE.BoxBufferGeometry(1, 1, 1);
    const positions = new Float32Array(boxGeometry.attributes.position.array.length * 8);
    const indices = new Uint16Array(boxGeometry.index.array.length * 8);

    const _pushBoxGeometry = m => {
      const g = boxGeometry.clone();
      g.applyMatrix4(m);
      positions.set(g.attributes.position.array, positionIndex);
      for (let i = 0; i < g.index.array.length; i++) {
        indices[indexIndex + i] = g.index.array[i] + positionIndex/3;
      }
      positionIndex += g.attributes.position.array.length;
      indexIndex += g.index.array.length;
    };

    const topLeft = new THREE.Vector3(-1, 0.5, -2);
    const topRight = new THREE.Vector3(1, 0.5, -2);
    const bottomLeft = new THREE.Vector3(-1, -0.5, -2);
    const bottomRight = new THREE.Vector3(1, -0.5, -2);
    const back = new THREE.Vector3(0, 0, 0);

    const _setMatrixBetweenPoints = (m, p1, p2) => {
      const quaternion = localQuaternion.setFromRotationMatrix(
        localMatrix.lookAt(
          p1,
          p2,
          localVector.set(0, 1, 0)
        )
      );
      const position = localVector.copy(p1)
        .add(p2)
        .divideScalar(2)
        // .add(new THREE.Vector3(0, 2, 0));
      const sc = 0.01;
      const scale = localVector2.set(sc, sc, p1.distanceTo(p2));
      m.compose(position, quaternion, scale);
      return m;
    };

    let positionIndex = 0;
    let indexIndex = 0;
    [
      [topLeft, back],
      [topRight, back],
      [bottomLeft, back],
      [bottomRight, back],
      [topLeft, topRight],
      [topRight, bottomRight],
      [bottomRight, bottomLeft],
      [bottomLeft, topLeft],
    ].forEach(e => {
      const [p1, p2] = e;
      _pushBoxGeometry(
        _setMatrixBetweenPoints(localMatrix, p1, p2)
      );
    });

    this.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.setIndex(new THREE.BufferAttribute(indices, 1));
  }
}

export default () => {
  const app = useApp();
  const {scene} = useInternals();
  
  const animations = useAvatarAnimations();
  // const walkAnimation = animations.find(a => a.name === 'walking.fbx');
  const runAnimation = animations.find(a => a.name === 'Fast Run.fbx');
  const runAnimationDuration = runAnimation.duration * 1.5;

  const cameraGeometry = new CameraGeometry();
  const cameraMaterial = new THREE.MeshBasicMaterial({
    color: 0x333333,
  });
  const cameraMesh = new THREE.Mesh(
    cameraGeometry,
    cameraMaterial,
  );
  scene.add(cameraMesh);
  
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style = `position: fixed; top: 0; left: 0; width: 1024px; height: 1024px; z-index: 10;`;
  document.body.appendChild(canvas);
  
  let spriteAvatarMesh = null;
  (async () => {
    
    const vrmUrl = `https://webaverse.github.io/app/public/avatars/Scillia_Drophunter_V19.vrm`;
    const m = await metaversefile.import(vrmUrl);
    const app2 = metaversefile.createApp();
    await app2.addModule(m);
    
    const renderer = new THREE.WebGLRenderer({
      preserveDrawingBuffer: true,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(texSize, texSize);
    // renderer.autoClear = false;
    renderer.sortObjects = false;
    renderer.physicallyCorrectLights = true;
    // renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.gammaFactor = 2.2;

    const camera2 = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const scene2 = new THREE.Scene();
    scene2.autoUpdate = false;

    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 2);
    scene2.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xFFFFFF, 2);
    directionalLight.position.set(1, 2, 3);
    scene2.add(directionalLight);
    
    await app2.setSkinning(true);
    
    const {skinnedVrm} = app2;
    // console.log('got app', skinnedVrm);
    const localRig = createAvatar(skinnedVrm, {
      fingers: true,
      hair: true,
      visemes: true,
      debug: false,
    });
    
    localRig.emotes.push({
      index: 2,
      value: 1,
    });
    
    // window.skinnedVrm = skinnedVrm;
    skinnedVrm.scene.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
      }
    });
    
    scene.add(app2);
    // renderer.render(scene2, camera2);

    const skeleton = (() => {
      let skeleton = null;
      app2.skinnedVrm.scene.traverse(o => {
        if (skeleton === null && o.isSkinnedMesh) {
          skeleton = o.skeleton;
        }
      });
      return skeleton;
    })();
    const rootBone = skeleton.bones.find(b => b.name === 'Root');
    
    // await _timeout(2000);
    
    // camera.position.set(0, -localRig.height/2, -2);
    // camera.lookAt(new THREE.Vector3(0, camera.position.y, 0));

    const ctx = canvas.getContext('2d');
    // document.body.appendChild(canvas);

    const _makeSpriteAvatarMesh = () => {
      const avatarSpriteGeometry = new THREE.PlaneBufferGeometry(worldSize, worldSize);
      const tex = new THREE.Texture(canvas);
      tex.needsUpdate = true;
      const avatarSpriteMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTex: {
            type: 't',
            value: tex,
            needsUpdate: true,
          },
          uTime: {
            type: 'f',
            value: 0,
            needsUpdate: true,
          },
          uY: {
            type: 'f',
            value: 0,
            needsUpdate: true,
          },
        },
        vertexShader: `\
          ${THREE.ShaderChunk.common}
          precision highp float;
          precision highp int;

          uniform vec4 uSelectRange;

          // attribute vec3 barycentric;
          attribute float ao;
          attribute float skyLight;
          attribute float torchLight;

          // varying vec3 vViewPosition;
          varying vec2 vUv;
          varying vec3 vBarycentric;
          varying float vAo;
          varying float vSkyLight;
          varying float vTorchLight;
          varying vec3 vSelectColor;
          varying vec2 vWorldUv;
          varying vec3 vPos;
          varying vec3 vNormal;

          ${THREE.ShaderChunk.logdepthbuf_pars_vertex}

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // vViewPosition = -mvPosition.xyz;
            vUv = uv;
            ${THREE.ShaderChunk.logdepthbuf_vertex}
          }
        `,
        fragmentShader: `\
          precision highp float;
          precision highp int;

          #define PI 3.1415926535897932384626433832795

          // uniform float sunIntensity;
          uniform sampler2D uTex;
          // uniform vec3 uColor;
          uniform float uTime;
          uniform float uY;
          // uniform vec3 sunDirection;
          // uniform float distanceOffset;
          float parallaxScale = 0.3;
          float parallaxMinLayers = 50.;
          float parallaxMaxLayers = 50.;

          // varying vec3 vViewPosition;
          varying vec2 vUv;
          varying vec3 vBarycentric;
          varying float vAo;
          varying float vSkyLight;
          varying float vTorchLight;
          varying vec3 vSelectColor;
          varying vec2 vWorldUv;
          varying vec3 vPos;
          varying vec3 vNormal;

          ${THREE.ShaderChunk.logdepthbuf_pars_fragment}

          float edgeFactor(vec2 uv) {
            float divisor = 0.5;
            float power = 0.5;
            return min(
              pow(abs(uv.x - round(uv.x/divisor)*divisor), power),
              pow(abs(uv.y - round(uv.y/divisor)*divisor), power)
            ) > 0.1 ? 0.0 : 1.0;
            /* return 1. - pow(abs(uv.x - round(uv.x/divisor)*divisor), power) *
              pow(abs(uv.y - round(uv.y/divisor)*divisor), power); */
          }

          vec3 getTriPlanarBlend(vec3 _wNorm){
            // in wNorm is the world-space normal of the fragment
            vec3 blending = abs( _wNorm );
            // blending = normalize(max(blending, 0.00001)); // Force weights to sum to 1.0
            // float b = (blending.x + blending.y + blending.z);
            // blending /= vec3(b, b, b);
            // return min(min(blending.x, blending.y), blending.z);
            blending = normalize(blending);
            return blending;
          }

          void main() {
            float angleIndex = floor(uY * ${numAngles.toFixed(8)});
            float animationIndex = floor(uTime * ${numFrames.toFixed(8)});
            float i = animationIndex + angleIndex * ${numFrames.toFixed(8)};
            float x = mod(i, ${numSlots.toFixed(8)});
            float y = (i - x) / ${numSlots.toFixed(8)};
            
            gl_FragColor = texture(
              uTex,
              vec2(0., 1. - 1./${numSlots.toFixed(8)}) +
                vec2(x, -y)/${numSlots.toFixed(8)} +
                vec2(1.-vUv.x, vUv.y)/${numSlots.toFixed(8)}
            );
            if (gl_FragColor.a < 0.5) {
              discard;
            }

            ${THREE.ShaderChunk.logdepthbuf_fragment}
          }
        `,
        transparent: true,
        // depthWrite: false,
        // polygonOffset: true,
        // polygonOffsetFactor: -2,
        // polygonOffsetUnits: 1,
        side: THREE.DoubleSide,
      });
      spriteAvatarMesh = new THREE.Mesh(avatarSpriteGeometry, avatarSpriteMaterial);
      spriteAvatarMesh.position.y = worldSize/2 - localRig.height * 0.2;
      return spriteAvatarMesh;
    };

    const spriteSpecs = [
      {
        name: 'run',
        duration: runAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              // console.log('render', timestamp);
    
              const timeDiffMs = timeDiff/1000;
              positionOffset -= speed * timeDiffMs;
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*0.5, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              // camera2.quaternion.setFromEuler(euler);
              camera2.updateMatrixWorld();
              camera2.lookAt(new THREE.Vector3(0, localRig.height*0.5, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
              
              /* const localPlayer = metaversefile.useLocalPlayer();
              const jumpAction = localPlayer.actions.find(action => action.type === 'jump');
              const jumpTime = jumpAction? jumpAction.time : -1;
              const flyAction = localPlayer.actions.find(action => action.type === 'fly');
              const flyTime = flyAction ? flyAction.time : -1;
              const useAction = localPlayer.actions.find(action => action.type === 'use');
              const useTime = useAction ? useAction.time : -1; */
              
              for (let h = 0; h < 2; h++) {
                localRig.setHandEnabled(h, false);
              }
              localRig.setTopEnabled(false);
              localRig.setBottomEnabled(false);
              // localRig.direction.set(0, 0, -1);
              // localRig.velocity.set(0, 0, -1);
              /* localRig.jumpState = !!jumpAction;
              localRig.jumpTime = jumpTime;
              localRig.flyState = !!flyAction;
              localRig.flyTime = flyTime;
              localRig.useTime = useTime; */
              // const useAnimation = (useAction?.animation) || '';
              // localRig.useAnimation = useAnimation;
    
              localRig.update(/*1000 +*/ timestamp, timeDiffMs, 100);
    
              window.app2 = app2;
              window.rig2 = localRig;
            },
          };
        },
      }
    ];
    const _captureImage = () => new Promise((accept, reject) => {
      renderer.domElement.toBlob(blob => {
        const img = new Image();
        const u = URL.createObjectURL(blob);
        img.onload = async () => {
          const imageBitmap = await createImageBitmap(img);
          accept(imageBitmap);
          URL.revokeObjectURL(u);
        };
        img.onerror = reject;
        img.crossOrigin = 'Anonymous';
        img.src = u;
      }, 'image/png');
    });
    const _render = () => {
      const oldParent = app2.parent;
      scene2.add(app2);

      renderer.render(scene2, camera2);
      
      if (oldParent) {
        oldParent.add(app2);
      } else {
        app2.parent.remove(app2);
      }
    };
    for (;;) {
      for (const spriteSpec of spriteSpecs) {
        const {name, duration} = spriteSpec;
        
        // console.log('generate sprite', name);

        const timeDiff = duration * 1000 / numFrames;
        let angleIndex = 0;
        for (let angle = 0; angle < Math.PI*2; angle += Math.PI*2/numAngles) {
          const spriteGenerator = spriteSpec.init({
            angle,
          });
          // pre-run the animation one cycle first, to stabilize the hair physics
          let now = 0;
          for (let j = 0; j < numFrames * 10; j++) {
            spriteGenerator.update(now, timeDiff);
            now += timeDiff;
          }
          const initialPositionOffset = localRig.inputs.hmd.position.z;
          // now perform the real capture
          for (let j = 0; j < numFrames; j++, angleIndex++) {
            spriteGenerator.update(now, timeDiff);
            now += timeDiff;

            _render();

            const positionOffset = localRig.inputs.hmd.position.z;
            rootBone.position.set(0, 0, positionOffset - initialPositionOffset);
            rootBone.updateMatrixWorld();

            cameraMesh.position.copy(camera2.position);
            cameraMesh.position.z -= initialPositionOffset;
            cameraMesh.quaternion.copy(camera2.quaternion);
            cameraMesh.updateMatrixWorld();

            const imageBitmap = await _captureImage();
            const x = angleIndex % numSlots;
            const y = (angleIndex - x) / numSlots;
            ctx.drawImage(imageBitmap, x * texSize, y * texSize);

            await _timeout(200);
          }
        }
      }
    }
    
    // spriteAvatarMesh = _makeSpriteAvatarMesh();
    // app.add(spriteAvatarMesh); 
  })();
  
  /* const {camera} = useInternals();
  useFrame(e => {
    if (spriteAvatarMesh) {
      localQuaternion
        .setFromRotationMatrix(
          localMatrix.lookAt(
            spriteAvatarMesh.getWorldPosition(localVector),
            camera.position,
            localVector2.set(0, 1, 0)
          )
        )
        .premultiply(app.quaternion.clone().invert());
      localEuler.setFromQuaternion(localQuaternion, 'YXZ');
      localEuler.x = 0;
      localEuler.z = 0;
      spriteAvatarMesh.quaternion.setFromEuler(localEuler);
      spriteAvatarMesh.updateMatrixWorld();
      
      spriteAvatarMesh.material.uniforms.uTime.value = (Date.now()/1000 % runAnimationDuration) / runAnimationDuration;
      spriteAvatarMesh.material.uniforms.uTime.needsUpdate = true;
      
      spriteAvatarMesh.material.uniforms.uY.value = mod(Math.PI + localEuler.y + Math.PI*2/numAngles/2, Math.PI*2) / (Math.PI*2);
      // console.log('value', spriteAvatarMesh.material.uniforms.uY.value);
      spriteAvatarMesh.material.uniforms.uY.needsUpdate = true;
    }
  }); */
  
  return app;
};