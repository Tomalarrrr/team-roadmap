// The parts of Phaser 4.2.1 that Slugs draws with. vite.config.ts serves this file in
// place of the 'phaser' package (see phaserParts there): the battlefield chunk built
// with it is 838 KB minified, 228 KB gzip, against 1,513 KB and 417 KB with the whole
// library. Types still come from the package, so a Phaser class used at run time and
// not exported here type-checks and then is undefined: add it below.
//
// Phaser registers each scene plugin and each `this.add` factory as its file loads. A
// scene skips a plugin that never registered without a word, so these imports are
// what make `this.cameras`, `this.add.image` and the rest exist.

import CONST from '../../../node_modules/phaser/src/const.js';
import Game from '../../../node_modules/phaser/src/core/Game.js';
import Scene from '../../../node_modules/phaser/src/scene/Scene.js';
import Renderer from '../../../node_modules/phaser/src/renderer/index.js';

import '../../../node_modules/phaser/src/events/EventEmitter.js';
import '../../../node_modules/phaser/src/cameras/2d/CameraManager.js';
import '../../../node_modules/phaser/src/gameobjects/DisplayList.js';
import '../../../node_modules/phaser/src/gameobjects/UpdateList.js';
import '../../../node_modules/phaser/src/gameobjects/GameObjectCreator.js';
import '../../../node_modules/phaser/src/gameobjects/GameObjectFactory.js';
import '../../../node_modules/phaser/src/scene/ScenePlugin.js';

import '../../../node_modules/phaser/src/gameobjects/image/ImageFactory.js';
import '../../../node_modules/phaser/src/gameobjects/graphics/GraphicsFactory.js';
import '../../../node_modules/phaser/src/gameobjects/text/TextFactory.js';
import '../../../node_modules/phaser/src/gameobjects/tilesprite/TileSpriteFactory.js';

export const AUTO = CONST.AUTO;
export { Game, Scene, Renderer };
