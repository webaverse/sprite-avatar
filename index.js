import * as THREE from 'three';
// import easing from './easing.js';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useLocalPlayer, useInternals, useGeometries, useAvatarSpriter} = metaversefile;
// import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export default () => {
  const app = useApp();
  const localPlayer = useLocalPlayer();
  const {scene, camera} = useInternals();
  const {CameraGeometry} = useGeometries();
  const {createSpriteMegaMesh} = useAvatarSpriter();

  const cameraGeometry = new CameraGeometry();
  const cameraMaterial = new THREE.MeshBasicMaterial({
    color: 0x333333,
  });
  const cameraMesh = new THREE.Mesh(
    cameraGeometry,
    cameraMaterial,
  );
  scene.add(cameraMesh);
  
  let spriteMegaAvatarMesh = null;
  (async () => {
    const vrmUrl = `https://webaverse.github.io/app/public/avatars/Scillia_Drophunter_V19.vrm`;
    const m = await metaversefile.import(vrmUrl);
    const app2 = metaversefile.createApp();
    await app2.addModule(m);
    
    await app2.setSkinning(true);
    
    scene.add(app2);

    spriteMegaAvatarMesh = createSpriteMegaMesh(app2.skinnedVrm);
    // spriteMegaAvatarMesh.updateMatrixWorld();
    scene.add(spriteMegaAvatarMesh);
    localPlayer.avatar.model.visible = false;
  })();

  useFrame(({timestamp, timeDiff}) => {
    spriteMegaAvatarMesh && spriteMegaAvatarMesh.update(timestamp, timeDiff, {
      player: localPlayer,
      camera,
    });
  });
  
  return app;
};