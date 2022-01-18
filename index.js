import * as THREE from 'three';
// import easing from './easing.js';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useLocalPlayer, usePhysics, useMaterials, createAvatar, useAvatarAnimations, useInternals, useCleanup} = metaversefile;
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

class DoubleSidedPlaneGeometry extends THREE.BufferGeometry {
  constructor(width, height, widthSegments, heightSegments) {
    super();

    const g1 = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments);
    const g2 = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments);
    g2.rotateY(Math.PI);
    // flip the uvs in the second geometry so that the texture is mirrored
    for (let i = 0; i < g2.attributes.uv.array.length; i += 2) {
      g2.attributes.uv.array[i] = 1 - g2.attributes.uv.array[i];
    }
    const g = BufferGeometryUtils.mergeBufferGeometries([g1, g2]);

    // clone the attributes t o the local geometry
    const attributes = g.attributes;
    for (const key in attributes) {
      if (attributes.hasOwnProperty(key)) {
        this.setAttribute(key, attributes[key]);
      }
    }
    // also clone the indices
    this.setIndex(g.index);
  }
}

const size = 4096;
const texSize = 512;
const numSlots = size / texSize;
const numFrames = 7;
const numAngles = 8;
const worldSize = 2;
const distance = 2.2; // render distance

// avatar animation constants
const walkSpeed = 3;
const runSpeed = 9;
const crouchSpeed = 2;
const narutoRunSpeed = 59;
const maxCrouchTime = 200;

const cameraHeightFactor = 0.8; // the height of the camera in avatar space
const spriteScaleFactor = 1.2; // scale up the final sprite by this much in world space
const spriteFootFactor = 0.07; // offset down this factor in world space

// opacity factor for sprites
const alphaTest = 0.9;

function angleDifference(angle1, angle2) {
  let a = angle2 - angle1;
  a = mod(a + Math.PI, Math.PI*2) - Math.PI;
  return a;
}
function getAngle(direction) {
  localEuler.setFromRotationMatrix(
    localMatrix.lookAt(
      localVector.set(0, 0, 0),
      direction,
      localVector2.set(0, 1, 0)
    ),
    'YXZ'
  );
  return localEuler.y;
}

const animationsAngleArrays = {
  walk: [
    {name: 'left', angle: Math.PI/2},
    {name: 'right', angle: -Math.PI/2},

    {name: 'forward', angle: 0},
    {name: 'backward', angle: Math.PI},

    // {name: 'left strafe walking reverse.fbx', angle: Math.PI*3/4},
    // {name: 'right strafe walking reverse.fbx', angle: -Math.PI*3/4},
  ],
};
const _getPlayerSide = () => {
  const localPlayer = useLocalPlayer();
  
  localEuler.setFromRotationMatrix(
    localMatrix.lookAt(
      localVector.set(0, 0, 0),
      localVector2.set(0, 0, -1)
        .applyQuaternion(localPlayer.quaternion),
      localVector3.set(0, 1, 0)
    ),
    'YXZ'
  );
  const forwardY = localEuler.y;
  
  localEuler.setFromRotationMatrix(
    localMatrix.lookAt(
      localVector.set(0, 0, 0),
      localVector2.copy(localPlayer.characterPhysics.velocity)
        .normalize(),
      localVector3.set(0, 1, 0)
    ),
    'YXZ'
  );
  const velocityY = localEuler.y;

  const angle = angleDifference(forwardY, velocityY);
  const animationAngleArray = animationsAngleArrays['walk'];
  animationAngleArray.sort((a, b) => {
    const aDistance = Math.abs(angleDifference(angle, a.angle));
    const bDistance = Math.abs(angleDifference(angle, b.angle));
    return aDistance - bDistance;
  });
  const closest2AnimationAngle = animationAngleArray[0];
  // console.log('got angle', angle, closest2AnimationAngle.name);
  return closest2AnimationAngle.name;
};

// console.log('sprite avatar index');

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector2D = new THREE.Vector2();
const localVector4D = new THREE.Vector4();
const localQuaternion = new THREE.Quaternion();
const localEuler = new THREE.Euler();
const localEuler2 = new THREE.Euler();
const localMatrix = new THREE.Matrix4();

// const y180Quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

const planeGeometry = new DoubleSidedPlaneGeometry(worldSize, worldSize);
const planeWarpedGeometry = planeGeometry.clone()
  .applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(0, worldSize/2 + (spriteScaleFactor-1)/2*worldSize - spriteFootFactor*worldSize, 0),
    new THREE.Quaternion(),
    new THREE.Vector3().setScalar(spriteScaleFactor),
  ));
const planeWarpedGeometry2 = planeGeometry.clone()
  .applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(0, worldSize/2 + (spriteScaleFactor-1)/2*worldSize - spriteFootFactor*worldSize, 0),
    new THREE.Quaternion(),
    new THREE.Vector3().setScalar(spriteScaleFactor),
  ));

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

const _addPlaneSpriteMaterialUniforms = (uniforms, tex, angleIndex) => {
  uniforms.uTex = {
    type: 't',
    value: tex,
    // needsUpdate: true,
  };
  uniforms.uTime = {
    type: 'f',
    value: 0,
    needsUpdate: true,
  };
  uniforms.uAngleIndex = {
    type: 'f',
    value: angleIndex,
    needsUpdate: true,
  };
  return uniforms;
};
class PlaneSpriteDepthMaterial extends THREE.MeshNormalMaterial {
  constructor(options = {}, options2 = {}) {
    super(options);
    // this.blending = THREE.NoBlending;
    this.transparent = true;

    this.uniforms = null;
    this.options2 = options2;
  }
  onBeforeCompile(parameters) {
    parameters.uniforms = _addPlaneSpriteMaterialUniforms(parameters.uniforms, this.options2.tex, this.options2.angleIndex);
    this.uniforms = parameters.uniforms;

    parameters.vertexShader = parameters.vertexShader.replace('void main() {\n', `\
      // attribute vec2 uv;
      varying vec2 vUv;
    ` + 'void main() {\n' + `\
      vUv = uv;
    `);
    parameters.fragmentShader = parameters.fragmentShader.replace('void main() {\n', `\
      uniform float uTime;
      uniform float uAngleIndex;
      uniform sampler2D uTex;
      varying vec2 vUv;
    ` + 'void main() {\n' + `\
      float animationIndex = floor(uTime * ${numFrames.toFixed(8)});
      float i = animationIndex + uAngleIndex;
      float x = mod(i, ${numSlots.toFixed(8)});
      float y = (i - x) / ${numSlots.toFixed(8)};
      
      vec4 tCol = texture(
        uTex,
        vec2(0., 1. - 1./${numSlots.toFixed(8)}) +
          vec2(x, -y)/${numSlots.toFixed(8)} +
          vec2(1.-vUv.x, vUv.y)/${numSlots.toFixed(8)}
      );
      if (tCol.a < ${alphaTest.toFixed(8)}) {
        discard;
      }
    `);

    // console.log('got normal map shader', parameters.vertexShader, parameters.fragmentShader);
  }
}
const _addAvatarSpriteMaterialUniforms = (uniforms, tex) => {
  uniforms.uTex = {
    type: 't',
    value: tex,
    // needsUpdate: true,
  };
  uniforms.uTime = {
    type: 'f',
    value: 0,
    needsUpdate: true,
  };
  uniforms.uY = {
    type: 'f',
    value: 0,
    needsUpdate: true,
  };
  return uniforms;
};
class AvatarSpriteDepthMaterial extends THREE.MeshNormalMaterial {
  constructor(options = {}, options2 = {}) {
    super(options);
    // this.blending = THREE.NoBlending;
    this.transparent = true;

    this.uniforms = null;
    this.options2 = options2;
  }
  onBeforeCompile(parameters) {
    parameters.uniforms = _addAvatarSpriteMaterialUniforms(parameters.uniforms, this.options2.tex);
    this.uniforms = parameters.uniforms;

    parameters.vertexShader = parameters.vertexShader.replace('void main() {\n', `\
      // attribute vec2 uv;
      varying vec2 vUv;
    ` + 'void main() {\n' + `\
      vUv = uv;
    `);
    parameters.fragmentShader = parameters.fragmentShader.replace('void main() {\n', `\
      uniform float uTime;
      uniform float uY;
      uniform sampler2D uTex;
      varying vec2 vUv;
    ` + 'void main() {\n' + `\
      float angleIndex = floor(uY * ${numAngles.toFixed(8)});
      float animationIndex = floor(uTime * ${numFrames.toFixed(8)});
      float i = animationIndex + angleIndex * ${numFrames.toFixed(8)};
      float x = mod(i, ${numSlots.toFixed(8)});
      float y = (i - x) / ${numSlots.toFixed(8)};
      
      vec4 tCol = texture(
        uTex,
        vec2(0., 1. - 1./${numSlots.toFixed(8)}) +
          vec2(x, -y)/${numSlots.toFixed(8)} +
          vec2(1.-vUv.x, vUv.y)/${numSlots.toFixed(8)}
      );
      // gl_FragColor.r = 1.;
      // gl_FragColor.a = 1.;
      if (tCol.a < ${alphaTest}) {
        discard;
      }
     //  gl_FragColor.a = 1.;
    `);

    // console.log('got normal map shader', parameters.vertexShader, parameters.fragmentShader);
  }
}

export default () => {
  const app = useApp();
  const localPlayer = useLocalPlayer();
  const {WebaverseShaderMaterial} = useMaterials();
  const {renderer, scene, camera} = useInternals();
  
  const animations = useAvatarAnimations();
  const walkAnimation = animations.find(a => a.name === 'walking.fbx');
  const walkBackwardAnimation = animations.find(a => a.name === 'walking backwards.fbx');
  const runAnimation = animations.find(a => a.name === 'Fast Run.fbx');
  const runBackwardAnimation = animations.find(a => a.name === 'running backwards.fbx');
  const leftStrafeRunAnimation = animations.find(a => a.name === 'left strafe.fbx');
  const rightStrafeRunAnimation = animations.find(a => a.name === 'right strafe.fbx');
  const idleAnimation = animations.find(a => a.name === 'idle.fbx');
  const crouchIdleAnimation = animations.find(a => a.name === 'Crouch Idle.fbx');
  const crouchWalkAnimation = animations.find(a => a.name === 'Sneaking Forward.fbx');
  const crouchWalkBackwardAnimation = animations.find(a => a.name === 'Sneaking Forward reverse.fbx');
  const narutoRunAnimation = animations.find(a => a.name === 'naruto run.fbx');
  const jumpAnimation = animations.find(a => a.name === 'jump.fbx');
  const leftStrafeWalkingAnimation = animations.find(a => a.name === 'left strafe walking.fbx');
  const rightStrafeWalkingAnimation = animations.find(a => a.name === 'right strafe walking.fbx');
  const crouchWalkLeftAnimation = animations.find(a => a.name === 'Crouched Sneaking Left.fbx');
  const crouchWalkRightAnimation = animations.find(a => a.name === 'Crouched Sneaking Right.fbx');

  // window.animations = animations;

  const cameraGeometry = new CameraGeometry();
  const cameraMaterial = new THREE.MeshBasicMaterial({
    color: 0x333333,
  });
  const cameraMesh = new THREE.Mesh(
    cameraGeometry,
    cameraMaterial,
  );
  scene.add(cameraMesh);
  
  const planeSpriteMeshes = [];
  const spriteAvatarMeshes = [];
  let spriteMegaAvatarMesh = null;
  let localRig = null;
  let spriteSpecs = null;
  (async () => {
    const vrmUrl = `https://webaverse.github.io/app/public/avatars/Scillia_Drophunter_V19.vrm`;
    const m = await metaversefile.import(vrmUrl);
    const app2 = metaversefile.createApp();
    await app2.addModule(m);
    
    /* const renderer = new THREE.WebGLRenderer({
      preserveDrawingBuffer: true,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(texSize, texSize); */
    
    /* // renderer.autoClear = false;
    renderer.sortObjects = false;
    renderer.physicallyCorrectLights = true;
    // renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.gammaFactor = 2.2; */

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
    localRig = createAvatar(skinnedVrm, {
      fingers: true,
      hair: true,
      visemes: true,
      debug: false,
    });
    for (let h = 0; h < 2; h++) {
      localRig.setHandEnabled(h, false);
    }
    localRig.setTopEnabled(false);
    localRig.setBottomEnabled(false);
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

    const _makeSpritePlaneMesh = (tex, {angleIndex}) => {
      const planeSpriteMaterial = new WebaverseShaderMaterial({
        uniforms: {
          uTex: {
            type: 't',
            value: tex,
            // needsUpdate: true,
          },
          uTime: {
            type: 'f',
            value: 0,
            needsUpdate: true,
          },
          uAngleIndex: {
            type: 'f',
            value: angleIndex,
            needsUpdate: true,
          },
        },
        vertexShader: `\
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

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // vViewPosition = -mvPosition.xyz;
            vUv = uv;
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
          // uniform vec3 sunDirection;
          // uniform float distanceOffset;
          uniform float uAngleIndex;
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
            float animationIndex = floor(uTime * ${numFrames.toFixed(8)});
            float i = animationIndex + uAngleIndex;
            float x = mod(i, ${numSlots.toFixed(8)});
            float y = (i - x) / ${numSlots.toFixed(8)};
            
            gl_FragColor = texture(
              uTex,
              vec2(0., 1. - 1./${numSlots.toFixed(8)}) +
                vec2(x, -y)/${numSlots.toFixed(8)} +
                vec2(1.-vUv.x, vUv.y)/${numSlots.toFixed(8)}
            );
            // gl_FragColor.r = 1.;
            // gl_FragColor.a = 1.;
            if (gl_FragColor.a < ${alphaTest}) {
              discard;
            }
            gl_FragColor.a = 1.;
          }
        `,
        transparent: true,
        // depthWrite: false,
        // polygonOffset: true,
        // polygonOffsetFactor: -2,
        // polygonOffsetUnits: 1,
        // side: THREE.DoubleSide,
      });
      const planeSpriteMesh = new THREE.Mesh(planeGeometry, planeSpriteMaterial);
      planeSpriteMesh.customPostMaterial = new PlaneSpriteDepthMaterial(undefined, {
        tex,
        angleIndex,
      });
      /* const normalMaterial = new THREE.MeshNormalMaterial();
      normalMaterial.blending = THREE.NoBlending;
      planeSpriteMesh.customPostMaterial = normalMaterial; */
      return planeSpriteMesh;
    };
    const _makeSpriteAvatarMesh = tex => {
      const avatarSpriteMaterial = new WebaverseShaderMaterial({
        uniforms: {
          uTex: {
            type: 't',
            value: tex,
            // needsUpdate: true,
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

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // vViewPosition = -mvPosition.xyz;
            vUv = uv;
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
            // gl_FragColor.r = 1.;
            // gl_FragColor.a = 1.;
            if (gl_FragColor.a < ${alphaTest}) {
              discard;
            }
            gl_FragColor.a = 1.;
          }
        `,
        transparent: true,
        // depthWrite: false,
        // polygonOffset: true,
        // polygonOffsetFactor: -2,
        // polygonOffsetUnits: 1,
        // side: THREE.DoubleSide,
      });
      const spriteAvatarMesh = new THREE.Mesh(planeWarpedGeometry, avatarSpriteMaterial);
      spriteAvatarMesh.customPostMaterial = new AvatarSpriteDepthMaterial(undefined, {
        tex,
      });
      return spriteAvatarMesh;
    };
    const _makeSpriteMegaAvatarMesh = (rig, texs) => {
      const tex = texs[0];
      const avatarMegaSpriteMaterial = new WebaverseShaderMaterial({
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

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // vViewPosition = -mvPosition.xyz;
            vUv = uv;
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
            // gl_FragColor.r = 1.;
            // gl_FragColor.a = 1.;
            if (gl_FragColor.a < ${alphaTest}) {
              discard;
            }
            gl_FragColor.a = 1.;
          }
        `,
        transparent: true,
        // depthWrite: false,
        // polygonOffset: true,
        // polygonOffsetFactor: -2,
        // polygonOffsetUnits: 1,
        // side: THREE.DoubleSide,
      });
      const spriteMegaAvatarMesh = new THREE.Mesh(planeWarpedGeometry2, avatarMegaSpriteMaterial);
      spriteMegaAvatarMesh.customPostMaterial = new AvatarSpriteDepthMaterial(undefined, {
        tex,
      });
      spriteMegaAvatarMesh.setTexture = name => {
        const tex = texs.find(t => t.name === name);
        if (tex) {
          avatarMegaSpriteMaterial.uniforms.uTex.value = tex;
          avatarMegaSpriteMaterial.uniforms.uTex.needsUpdate = true;

          if (spriteMegaAvatarMesh.customPostMaterial.uniforms) {
            spriteMegaAvatarMesh.customPostMaterial.uniforms.uTex.value = tex;
            spriteMegaAvatarMesh.customPostMaterial.uniforms.uTex.needsUpdate = true;
          }
          
          return true;
        } else {
          return false;
        }
      };
      return spriteMegaAvatarMesh;
    };

    spriteSpecs = [
      {
        name: 'idle',
        duration: idleAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              // positionOffset -= walkSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'walk',
        duration: walkAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= walkSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'walk left',
        duration: leftStrafeWalkingAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= walkSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(positionOffset, localRig.height*cameraHeightFactor, 0)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffset, localRig.height*cameraHeightFactor, 0));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffset, localRig.height, 0);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'walk right',
        duration: rightStrafeWalkingAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += walkSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(positionOffset, localRig.height*cameraHeightFactor, 0)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffset, localRig.height*cameraHeightFactor, 0));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffset, localRig.height, 0);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'walk backward',
        duration: walkBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += walkSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'run',
        duration: runAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= runSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'run left',
        duration: leftStrafeRunAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= runSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(positionOffset, localRig.height*cameraHeightFactor, 0)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffset, localRig.height*cameraHeightFactor, 0));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffset, localRig.height, 0);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'run right',
        duration: rightStrafeRunAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += runSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(positionOffset, localRig.height*cameraHeightFactor, 0)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffset, localRig.height*cameraHeightFactor, 0));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffset, localRig.height, 0);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'run backward',
        duration: runBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += runSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'crouch idle',
        duration: crouchIdleAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              // positionOffset -= crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();

              localRig.crouchTime = 0;
    
              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      },
      {
        name: 'crouch walk',
        duration: crouchWalkAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();

              localRig.crouchTime = 0;
    
              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      },
      {
        name: 'crouch walk left',
        duration: crouchWalkLeftAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(positionOffset, localRig.height*cameraHeightFactor, 0)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffset, localRig.height*cameraHeightFactor, 0));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffset, localRig.height, 0);
              localRig.inputs.hmd.updateMatrixWorld();

              localRig.crouchTime = 0;
    
              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      },
      {
        name: 'crouch walk right',
        duration: crouchWalkRightAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(positionOffset, localRig.height*cameraHeightFactor, 0)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffset, localRig.height*cameraHeightFactor, 0));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffset, localRig.height, 0);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.crouchTime = 0;

              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      },
      {
        name: 'crouch walk backward',
        duration: crouchWalkBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.crouchTime = 0;

              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      },
      {
        name: 'naruto run',
        duration: narutoRunAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          let narutoRunTime = 0;
          const narutoRunIncrementSpeed = 1000 * 4;

          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset -= narutoRunSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();

              localRig.narutoRunState = true;
              localRig.narutoRunTime = narutoRunTime;

              narutoRunTime += timeDiffMs * narutoRunIncrementSpeed;

              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
        cleanup() {
          localRig.narutoRunState = false;
        },
      },
      {
        name: 'jump',
        duration: jumpAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          
          // console.log('jump init', localPlayer.characterPhysics.velocity.toArray().join(', '));
          // localPlayer.characterPhysics.velocity.y += 6;

          let jumpTime = -200;
          const jumpIncrementSpeed = 250;

          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              // positionOffset -= walkSpeed/1000 * timeDiffMs;

              // console.log('jump update', localPlayer.characterPhysics.velocity.toArray().join(', '));
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              camera2.position.set(0, localRig.height*cameraHeightFactor, positionOffset)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(0, localRig.height*cameraHeightFactor, positionOffset));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(0, localRig.height, positionOffset);
              localRig.inputs.hmd.updateMatrixWorld();

              localRig.jumpState = true;
              localRig.jumpTime = jumpTime;

              jumpTime += timeDiffMs * jumpIncrementSpeed;
              
              // console.log('got jump time', jumpTime, timeDiffMs, jumpIncrementSpeed);
    
              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.jumpState = false;
            },
          };
        },
      },
      /* {
        name: 'run backward left',
        duration: runBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += runSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              const positionOffsetDiff = positionOffset/Math.SQRT2;
              camera2.position.set(-positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(-positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(-positionOffsetDiff, localRig.height, positionOffsetDiff);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'run backward right',
        duration: runBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += runSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              const positionOffsetDiff = positionOffset/Math.SQRT2;
              camera2.position.set(positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffsetDiff, localRig.height, positionOffsetDiff);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'walk backward left',
        duration: walkBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += walkSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              const positionOffsetDiff = positionOffset/Math.SQRT2;
              camera2.position.set(-positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(-positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(-positionOffsetDiff, localRig.height, positionOffsetDiff);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'walk backward right',
        duration: walkBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += walkSpeed/1000 * timeDiffMs;

              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              const positionOffsetDiff = positionOffset/Math.SQRT2;
              camera2.position.set(positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffsetDiff, localRig.height, positionOffsetDiff);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.update(timestamp, timeDiffMs);
            },
          };
        },
      },
      {
        name: 'crouch walk backward left',
        duration: crouchWalkBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              const positionOffsetDiff = positionOffset/Math.SQRT2;
              camera2.position.set(-positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(-positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(-positionOffsetDiff, localRig.height, positionOffsetDiff);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.crouchTime = 0;

              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      },
      {
        name: 'crouch walk backward right',
        duration: crouchWalkBackwardAnimation.duration,
        init({angle}) {
          let positionOffset = 0;
          return {
            update(timestamp, timeDiff) {
              const timeDiffMs = timeDiff/1000;
              positionOffset += crouchSpeed/1000 * timeDiffMs;
              
              const euler = new THREE.Euler(0, angle, 0, 'YXZ');
              const positionOffsetDiff = positionOffset/Math.SQRT2;
              camera2.position.set(positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff)
                .add(new THREE.Vector3(0, 0, -distance).applyEuler(euler));
              camera2.lookAt(new THREE.Vector3(positionOffsetDiff, localRig.height*cameraHeightFactor, positionOffsetDiff));
              camera2.updateMatrixWorld();
              
              localRig.inputs.hmd.position.set(positionOffsetDiff, localRig.height, positionOffsetDiff);
              localRig.inputs.hmd.updateMatrixWorld();
    
              localRig.crouchTime = 0;

              localRig.update(timestamp, timeDiffMs);
            },
            cleanup() {
              localRig.crouchTime = maxCrouchTime;
            },
          };
        },
      }, */
    ];
    // window.spriteSpecs = spriteSpecs;
    /* const _captureCanvas = (canvas, sx, sy, sw, sh, options) => new Promise((accept, reject) => {
      canvas.toBlob(blob => {
        const img = new Image();
        const u = URL.createObjectURL(blob);
        img.onload = async () => {
          const imageBitmap = await createImageBitmap(img, sx, sy, sw, sh, options);
          accept(imageBitmap);
          URL.revokeObjectURL(u);
        };
        img.onerror = reject;
        img.crossOrigin = 'Anonymous';
        img.src = u;
      }, 'image/png');
    }); */
    const pixelRatio = renderer.getPixelRatio();
    /* const _captureRender = () => {
      const canvas2 = document.createElement('canvas');
      canvas2.width = texSize;
      canvas2.height = texSize;
      const ctx2 = canvas2.getContext('2d');
      ctx2.drawImage(renderer.domElement, 0, renderer.domElement.height - texSize, texSize, texSize, 0, 0, texSize, texSize);
      return canvas2;
    }; */
    const _render = () => {
      const oldParent = app2.parent;
      scene2.add(app2);

      const rendererSize = renderer.getSize(localVector2D);
      if (rendererSize.x >= texSize && rendererSize.y >= texSize) {
        // push old renderer state
        // const oldParent = player.avatar.model.parent;
        // const oldRenderTarget = renderer.getRenderTarget();
        const oldViewport = renderer.getViewport(localVector4D);
        const oldClearAlpha = renderer.getClearAlpha();
        
        renderer.setViewport(0, 0, texSize/pixelRatio, texSize/pixelRatio);
        renderer.setClearAlpha(0);
        renderer.clear();
        renderer.render(scene2, camera2);

        // pop old renderer state
        /* if (oldParent) {
          oldParent.add(player.avatar.model);
        } else {
          player.avatar.model.parent.remove(player.avatar.model);
        } */
        // renderer.setRenderTarget(oldRenderTarget);
        renderer.setViewport(oldViewport);
        renderer.setClearAlpha(oldClearAlpha);
      }

      if (oldParent) {
        oldParent.add(app2);
      } else {
        app2.parent.remove(app2);
      }
    };

    let canvasIndex2 = 0;
    const spriteImages = [];
    for (const spriteSpec of spriteSpecs) {
      const {name, duration} = spriteSpec;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.style = `position: fixed; top: ${canvasIndex2*1024}px; left: 0; width: 1024px; height: 1024px; z-index: 10;`;
      // document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      // document.body.appendChild(canvas);
      const tex = new THREE.Texture(canvas);
      tex.name = name;
      // tex.minFilter = THREE.NearestFilter;
      // tex.magFilter = THREE.NearestFilter;
      // tex.flipY = true;
      let canvasIndex = 0;
      
      // console.log('generate sprite', name);

      const timeDiff = duration * 1000 / numFrames;
      let angleIndex = 0;
      for (let angle = 0; angle < Math.PI*2; angle += Math.PI*2/numAngles) {
        const spriteGenerator = spriteSpec.init({
          angle,
        });
        // pre-run the animation one cycle first, to stabilize the hair physics
        let now = 0;
        const startAngleIndex = angleIndex;
        for (let j = 0; j < numFrames; j++) {
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

          // const frameImageBitmap = _captureRender();
          const x = angleIndex % numSlots;
          const y = (angleIndex - x) / numSlots;
          // ctx.drawImage(frameImageBitmap, x * texSize, y * texSize);
          ctx.drawImage(
            renderer.domElement,
            0, renderer.domElement.height - texSize, texSize, texSize,
            x * texSize, y * texSize, texSize, texSize
          );
          tex.needsUpdate = true;
          // tex2.needsUpdate = true;

          await _timeout(50);
        }

        const planeSpriteMesh = _makeSpritePlaneMesh(tex, {
          angleIndex: startAngleIndex,
        });
        planeSpriteMesh.position.set(-canvasIndex*worldSize, 2, -canvasIndex2*worldSize);
        // planeSpriteMesh.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        planeSpriteMesh.updateMatrixWorld();
        planeSpriteMesh.spriteSpec = spriteSpec;
        app.add(planeSpriteMesh);
        planeSpriteMeshes.push(planeSpriteMesh);

        spriteGenerator.cleanup && spriteGenerator.cleanup();

        canvasIndex++;
      }

      // draw the full sprite sheet here
      const spriteAvatarMesh = _makeSpriteAvatarMesh(tex);
      spriteAvatarMesh.position.set(
        -canvasIndex*worldSize,
        0,
        -canvasIndex2*worldSize,
      );
      // spriteAvatarMesh.scale.setScalar(spriteScaleFactor);
      // spriteAvatarMesh.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      spriteAvatarMesh.updateMatrixWorld();
      spriteAvatarMesh.spriteSpec = spriteSpec;
      app.add(spriteAvatarMesh); 
      spriteAvatarMeshes.push(spriteAvatarMesh);
      
      canvasIndex2++;

      spriteImages.push(tex);
    }

    spriteMegaAvatarMesh = _makeSpriteMegaAvatarMesh(localRig, spriteImages);
    // spriteMegaAvatarMesh.position.set(0, worldSize/2 + (spriteScaleFactor - 1)*worldSize - spriteFootFactor*worldSize, 0);
    // spriteMegaAvatarMesh.scale.setScalar(spriteScaleFactor);
    // spriteMegaAvatarMesh.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    spriteMegaAvatarMesh.updateMatrixWorld();
    scene.add(spriteMegaAvatarMesh);
    localPlayer.avatar.model.visible = false;
  })();

  useFrame(({timestamp, timeDiff}) => {
    /* if (tex) {
      tex.needsUpdate = true;
    } */
    for (const planeSpriteMesh of planeSpriteMeshes) {
      const {duration} = planeSpriteMesh.spriteSpec;
      const uTime = (timestamp/1000 % duration) / duration;
      [planeSpriteMesh.material, planeSpriteMesh.customPostMaterial].forEach(material => {
        if (material?.uniforms) {
          material.uniforms.uTime.value = uTime;
          material.uniforms.uTime.needsUpdate = true;
        }
      });
    }

    for (const spriteAvatarMesh of spriteAvatarMeshes) {
      const {duration} = spriteAvatarMesh.spriteSpec;
      const uTime = (timestamp/1000 % duration) / duration;

      {
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
      }

      [
        spriteAvatarMesh.material,
        spriteAvatarMesh.customPostMaterial,
      ].forEach(material => {
        if (material?.uniforms) {
          material.uniforms.uTime.value = uTime;
          material.uniforms.uTime.needsUpdate = true;

          material.uniforms.uY.value = mod(localEuler.y + Math.PI*2/numAngles/2, Math.PI*2) / (Math.PI*2);
          material.uniforms.uY.needsUpdate = true;
        }
      });
    }
    if (spriteMegaAvatarMesh) {
      // matrix transform
      spriteMegaAvatarMesh.position.copy(localPlayer.position);
      spriteMegaAvatarMesh.position.y -= localRig.height;

      localQuaternion
        .setFromRotationMatrix(
          localMatrix.lookAt(
            spriteMegaAvatarMesh.getWorldPosition(localVector),
            camera.position,
            localVector2.set(0, 1, 0)
          )
        )
      localEuler.setFromQuaternion(localQuaternion, 'YXZ');
      localEuler.x = 0;
      localEuler.z = 0;

      spriteMegaAvatarMesh.quaternion.setFromEuler(localEuler);
      spriteMegaAvatarMesh.updateMatrixWorld();

      // select the texture
      const spriteSpecName = (() => {
        const playerSide = _getPlayerSide();
        const currentSpeed = localVector.set(localPlayer.characterPhysics.velocity.x, 0, localPlayer.characterPhysics.velocity.z)
          .length();

        if (localPlayer.avatar.jumpState) {
          return 'jump';
        } else if (localPlayer.avatar.narutoRunState) {
          return 'naruto run';
        } else if (localPlayer.avatar.crouchTime === 0) {
          const crouchIdleSpeedDistance = currentSpeed;
          const crouchSpeedDistance = Math.abs(crouchSpeed - currentSpeed);
          const speedDistances = [
            {
              name: 'crouch idle',
              distance: crouchIdleSpeedDistance,
            },
            {
              name: 'crouch',
              distance: crouchSpeedDistance,
            },
          ].sort((a, b) => a.distance - b.distance);
          const closestSpeedDistance = speedDistances[0];
          const spriteSpecBaseName = closestSpeedDistance.name;

          if (spriteSpecBaseName === 'crouch idle') {
            return 'crouch idle';
          } else if (spriteSpecBaseName === 'crouch') {
            if (playerSide === 'forward') {
              return 'crouch walk';
            } else if (playerSide === 'backward') {
              return 'crouch walk backward';
            } else if (playerSide === 'left') {
              return 'crouch walk left';
            } else if (playerSide === 'right') {
              return 'crouch walk  right';
            }
          }
        } else {
          const currentSpeed = localVector.set(localPlayer.characterPhysics.velocity.x, 0, localPlayer.characterPhysics.velocity.z).length();
          const idleSpeedDistance = currentSpeed;
          const walkSpeedDistance = Math.abs(walkSpeed - currentSpeed);
          const runSpeedDistance = Math.abs(runSpeed - currentSpeed);
          const speedDistances = [
            {
              name: 'idle',
              distance: idleSpeedDistance,
            },
            {
              name: 'walk',
              distance: walkSpeedDistance,
            },
            {
              name: 'run',
              distance: runSpeedDistance,
            },
          ].sort((a, b) => a.distance - b.distance);
          const closestSpeedDistance = speedDistances[0];
          const spriteSpecBaseName = closestSpeedDistance.name;
          if (spriteSpecBaseName === 'idle') {
            return 'idle';
          } else if (spriteSpecBaseName === 'walk') {
            if (playerSide === 'forward') {
              return 'walk';
            } else if (playerSide === 'backward') {
              return 'walk backward';
            } else if (playerSide === 'left') {
              return 'walk left';
            } else if (playerSide === 'right') {
              return 'walk right';
            }
          } else if (spriteSpecBaseName === 'run') {
            if (playerSide === 'forward') {
              return 'run';
            } else if (playerSide === 'backward') {
              return 'run backward';
            } else if (playerSide === 'left') {
              return 'run left';
            } else if (playerSide === 'right') {
              return 'run right';
            }
          }

          throw new Error('unhandled case');
        }
      })();
      spriteMegaAvatarMesh.setTexture(spriteSpecName);

      // general uniforms
      [
        spriteMegaAvatarMesh?.material,
        spriteMegaAvatarMesh?.customPostMaterial,
      ].forEach(material => {
        if (material?.uniforms) {
          const spriteSpec = spriteSpecs.find(s => s.name === spriteSpecName);
          const {duration} = spriteSpec;
          const uTime = (timestamp/1000 % duration) / duration;
          
          material.uniforms.uTime.value = uTime;
          material.uniforms.uTime.needsUpdate = true;

          localQuaternion
            .setFromRotationMatrix(
              localMatrix.lookAt(
                spriteMegaAvatarMesh.getWorldPosition(localVector),
                camera.position,
                localVector2.set(0, 1, 0)
              )
            )
          localEuler.setFromQuaternion(localQuaternion, 'YXZ');
          localEuler.x = 0;
          localEuler.z = 0;

          localEuler2.setFromQuaternion(localPlayer.quaternion, 'YXZ');
          localEuler2.x = 0;
          localEuler2.z = 0;

          material.uniforms.uY.value = mod(localEuler.y - localEuler2.y + Math.PI*2/numAngles/2, Math.PI*2) / (Math.PI*2);
          material.uniforms.uY.needsUpdate = true;
        }
      });
    }
  });
  
  return app;
};