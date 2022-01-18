import * as THREE from 'three';
// import easing from './easing.js';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useLocalPlayer, usePhysics, useMaterials, createAvatar, useAvatarAnimations, useInternals, useCleanup} = metaversefile;
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const preview = false; // whether to draw debug meshes

const {WebaverseShaderMaterial} = useMaterials();
const animations = useAvatarAnimations();

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector2D = new THREE.Vector2();
const localVector4D = new THREE.Vector4();
const localQuaternion = new THREE.Quaternion();
const localEuler = new THREE.Euler();
const localEuler2 = new THREE.Euler();
const localMatrix = new THREE.Matrix4();

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

class SpritePlaneMesh extends THREE.Mesh {
  constructor(tex, {angleIndex}) {
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
    super(planeGeometry, planeSpriteMaterial);
    this.customPostMaterial = new PlaneSpriteDepthMaterial(undefined, {
      tex,
      angleIndex,
    });
    return this;
  }
}
class SpriteAvatarMesh extends THREE.Mesh {
  constructor(tex) {
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
    super(planeWarpedGeometry, avatarSpriteMaterial);
    this.customPostMaterial = new AvatarSpriteDepthMaterial(undefined, {
      tex,
    });
    // return spriteAvatarMesh;
  }
}
class SpriteMegaAvatarMesh extends THREE.Mesh {
  constructor(texs) {
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
    super(planeWarpedGeometry2, avatarMegaSpriteMaterial);
    this.customPostMaterial = new AvatarSpriteDepthMaterial(undefined, {
      tex,
    });
    this.setTexture = name => {
      const tex = texs.find(t => t.name === name);
      if (tex) {
        avatarMegaSpriteMaterial.uniforms.uTex.value = tex;
        avatarMegaSpriteMaterial.uniforms.uTex.needsUpdate = true;

        if (this.customPostMaterial.uniforms) {
          this.customPostMaterial.uniforms.uTex.value = tex;
          this.customPostMaterial.uniforms.uTex.needsUpdate = true;
        }
        
        return true;
      } else {
        return false;
      }
    };
  }
}

function angleDifference(angle1, angle2) {
  let a = angle2 - angle1;
  a = mod(a + Math.PI, Math.PI*2) - Math.PI;
  return a;
}
const animationAngles = [
  {name: 'left', angle: Math.PI/2},
  {name: 'right', angle: -Math.PI/2},

  {name: 'forward', angle: 0},
  {name: 'backward', angle: Math.PI},
];
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
  animationAngles.sort((a, b) => {
    const aDistance = Math.abs(angleDifference(angle, a.angle));
    const bDistance = Math.abs(angleDifference(angle, b.angle));
    return aDistance - bDistance;
  });
  const closest2AnimationAngle = animationAngles[0];
  return closest2AnimationAngle.name;
};

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

const camera2 = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
const scene2 = new THREE.Scene();
scene2.autoUpdate = false;
const ambientLight = new THREE.AmbientLight(0xFFFFFF, 2);
scene2.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xFFFFFF, 2);
directionalLight.position.set(1, 2, 3);
scene2.add(directionalLight);

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
const spriteSpecs = [
  {
    name: 'idle',
    duration: idleAnimation.duration,
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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
    init({angle, avatar: localRig}) {
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

function mod(a, n) {
  return ((a % n) + n) % n;
}
/* const _timeout = (t = 1000) => new Promise((accept, reject) => {
  setTimeout(accept, t);
}); */

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
  }
}

export default () => {
  const app = useApp();
  const localPlayer = useLocalPlayer();
  const {renderer, scene, camera} = useInternals();

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
  (async () => {
    const vrmUrl = `https://webaverse.github.io/app/public/avatars/Scillia_Drophunter_V19.vrm`;
    const m = await metaversefile.import(vrmUrl);
    const app2 = metaversefile.createApp();
    await app2.addModule(m);
    
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
    
    skinnedVrm.scene.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
      }
    });
    
    scene.add(app2);

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

    const pixelRatio = renderer.getPixelRatio();
    const _render = () => {
      const oldParent = app2.parent;
      scene2.add(app2);

      const rendererSize = renderer.getSize(localVector2D);
      if (rendererSize.x >= texSize && rendererSize.y >= texSize) {
        // push old renderer state
        const oldViewport = renderer.getViewport(localVector4D);
        const oldClearAlpha = renderer.getClearAlpha();
        
        renderer.setViewport(0, 0, texSize/pixelRatio, texSize/pixelRatio);
        renderer.setClearAlpha(0);
        renderer.clear();
        renderer.render(scene2, camera2);

        // pop old renderer state
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
    // console.time('render');
    for (const spriteSpec of spriteSpecs) {
      const {name, duration} = spriteSpec;

      // console.log('spritesheet', name);

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      // canvas.style.cssText = `position: fixed; top: ${canvasIndex2*1024}px; left: 0; width: 1024px; height: 1024px; z-index: 10;`;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.Texture(canvas);
      tex.name = name;
      // tex.minFilter = THREE.NearestFilter;
      // tex.magFilter = THREE.NearestFilter;
      let canvasIndex = 0;
      
      // console.log('generate sprite', name);

      const timeDiff = duration * 1000 / numFrames;
      let angleIndex = 0;
      for (let angle = 0; angle < Math.PI*2; angle += Math.PI*2/numAngles) {
        // console.log('angle', angle/(Math.PI*2)*360);

        const spriteGenerator = spriteSpec.init({
          angle,
          avatar: localRig,
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

          if (preview) {
            const positionOffset = localRig.inputs.hmd.position.z;
            rootBone.position.set(0, 0, positionOffset - initialPositionOffset);
            rootBone.updateMatrixWorld();

            cameraMesh.position.copy(camera2.position);
            cameraMesh.position.z -= initialPositionOffset;
            cameraMesh.quaternion.copy(camera2.quaternion);
            cameraMesh.updateMatrixWorld();
          }

          const x = angleIndex % numSlots;
          const y = (angleIndex - x) / numSlots;
          ctx.drawImage(
            renderer.domElement,
            0, renderer.domElement.height - texSize, texSize, texSize,
            x * texSize, y * texSize, texSize, texSize
          );
          tex.needsUpdate = true;

          // await _timeout(50);
        }

        if (preview) {
          const planeSpriteMesh = new SpritePlaneMesh(tex, {
            angleIndex: startAngleIndex,
          });
          planeSpriteMesh.position.set(-canvasIndex*worldSize, 2, -canvasIndex2*worldSize);
          planeSpriteMesh.updateMatrixWorld();
          planeSpriteMesh.spriteSpec = spriteSpec;
          app.add(planeSpriteMesh);
          planeSpriteMeshes.push(planeSpriteMesh);
        }

        spriteGenerator.cleanup && spriteGenerator.cleanup();

        canvasIndex++;
      }

      if (preview) {
        const spriteAvatarMesh = new SpriteAvatarMesh(tex);
        spriteAvatarMesh.position.set(
          -canvasIndex*worldSize,
          0,
          -canvasIndex2*worldSize,
        );
        spriteAvatarMesh.updateMatrixWorld();
        spriteAvatarMesh.spriteSpec = spriteSpec;
        app.add(spriteAvatarMesh); 
        spriteAvatarMeshes.push(spriteAvatarMesh);
      }
      
      canvasIndex2++;

      spriteImages.push(tex);
    }
    // console.timeEnd('render');

    spriteMegaAvatarMesh = new SpriteMegaAvatarMesh(spriteImages);
    spriteMegaAvatarMesh.updateMatrixWorld();
    scene.add(spriteMegaAvatarMesh);
    localPlayer.avatar.model.visible = false;
  })();

  useFrame(({timestamp, timeDiff}) => {
    if (preview) {
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