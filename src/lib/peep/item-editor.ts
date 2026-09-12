import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  ITEM_COLORS,
  ITEM_HEX,
  hexToInt,
  kindFromHex,
  readStoredItem,
  serializeItemVoxels,
  writeStoredItem,
  type ItemKind,
  type ItemVoxel,
} from "./item-voxels";

const HALF = 8;
const TAP = 12;

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class ItemEditor {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly gripNdc = new THREE.Vector3();
  private readonly voxels = new Map<string, THREE.Mesh>();
  private readonly plane: THREE.Mesh;
  private readonly ghost: THREE.Mesh;
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly mats = new Map<string, THREE.MeshBasicMaterial>();
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private kind: ItemKind = "wood";
  private erase = false;
  private down = { x: 0, y: 0, button: 0 };
  private dragging = false;
  private disposed = false;
  onChange: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x1a1612);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    this.camera.position.set(10, 9, 12);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.AmbientLight(0xfff1dc, 0.85));
    const sun = new THREE.DirectionalLight(0xffd09a, 0.55);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(16, 16, 0xb85c38, 0x3a332c);
    grid.position.set(0, 0, 0);
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(0.95);
    axes.position.set(0, 0, 0);
    this.scene.add(axes);

    const gripGeo = new THREE.BoxGeometry(0.88, 0.88, 0.88);
    const grip = new THREE.Mesh(
      gripGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3b32,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    grip.position.set(0, 0, 0);
    grip.renderOrder = 3;
    grip.raycast = () => {};
    this.scene.add(grip);
    const gripEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(gripGeo),
      new THREE.LineBasicMaterial({ color: 0xff6a62, transparent: true, opacity: 0.9 }),
    );
    gripEdge.position.set(0, 0, 0);
    gripEdge.raycast = () => {};
    this.scene.add(gripEdge);

    const planeGeo = new THREE.PlaneGeometry(16, 16);
    planeGeo.rotateX(-Math.PI / 2);
    this.plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.plane);

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: ITEM_COLORS.wood,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(this.box, this.ghostMat);
    this.ghost.visible = false;
    this.ghost.raycast = () => {};
    this.scene.add(this.ghost);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    // RMB is delete only — orbit uses LMB drag / wheel / two-finger.
    this.controls.mouseButtons.RIGHT = -1 as THREE.MOUSE;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("contextmenu", this.onMenu);

    const stored = readStoredItem();
    if (stored) this.addMany(stored);

    this.resize();
    this.renderer.setAnimationLoop(this.tick);
    window.addEventListener("resize", this.resize);
  }

  setKind(kind: ItemKind) {
    this.kind = kind;
    this.ghostMat.color.setHex(ITEM_COLORS[kind]);
  }

  getKind(): ItemKind {
    return this.kind;
  }

  setErase(on: boolean) {
    this.erase = on;
  }

  isErase(): boolean {
    return this.erase;
  }

  voxelsList(): ItemVoxel[] {
    const list: ItemVoxel[] = [];
    for (const mesh of this.voxels.values()) {
      const { x, y, z, color } = mesh.userData as ItemVoxel;
      list.push({ x, y, z, color });
    }
    list.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
    return list;
  }

  toJSON(): string {
    return serializeItemVoxels(this.voxelsList());
  }

  load(voxels: ItemVoxel[]) {
    this.wipe();
    this.addMany(voxels);
    this.persist();
  }

  clear() {
    this.wipe();
    this.persist();
  }

  persist() {
    writeStoredItem(this.voxelsList());
    this.onChange?.();
  }

  projectGrip(): { x: number; y: number; visible: boolean } {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.gripNdc.set(0, 0, 0).project(this.camera);
    const behind = this.gripNdc.z < -1 || this.gripNdc.z > 1;
    return {
      x: (this.gripNdc.x * 0.5 + 0.5) * w,
      y: (-this.gripNdc.y * 0.5 + 0.5) * h,
      visible: !behind,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointerleave", this.onLeave);
    canvas.removeEventListener("contextmenu", this.onMenu);
    this.controls.dispose();
    this.box.dispose();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.ghostMat.dispose();
    for (const mat of this.mats.values()) mat.dispose();
    this.renderer.dispose();
  }

  private wipe() {
    for (const mesh of this.voxels.values()) this.scene.remove(mesh);
    this.voxels.clear();
  }

  private addMany(voxels: ItemVoxel[]) {
    for (const v of voxels) this.addVoxel(v.x, v.y, v.z, v.color);
  }

  private material(color: string): THREE.MeshBasicMaterial {
    const hex = color.startsWith("#") ? color : ITEM_HEX[kindFromHex(color)];
    let mat = this.mats.get(hex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: hexToInt(hex) });
      this.mats.set(hex, mat);
    }
    return mat;
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= -HALF && x < HALF && z >= -HALF && z < HALF && y >= 0 && y < 16;
  }

  private addVoxel(x: number, y: number, z: number, color: string) {
    if (!this.inBounds(x, y, z)) return;
    const key = keyOf(x, y, z);
    if (this.voxels.has(key)) return;
    const mesh = new THREE.Mesh(this.box, this.material(color));
    mesh.position.set(x, y, z);
    mesh.userData = { x, y, z, color } satisfies ItemVoxel;
    this.scene.add(mesh);
    this.voxels.set(key, mesh);
  }

  private place(x: number, y: number, z: number) {
    this.addVoxel(x, y, z, ITEM_HEX[this.kind]);
    if (this.voxels.has(keyOf(x, y, z))) this.persist();
  }

  private remove(x: number, y: number, z: number) {
    const key = keyOf(x, y, z);
    const mesh = this.voxels.get(key);
    if (!mesh) return;
    this.scene.remove(mesh);
    this.voxels.delete(key);
    this.persist();
  }

  private pick(clientX: number, clientY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const solids = [...this.voxels.values()];
    const hits = this.raycaster.intersectObjects(solids, false);
    if (hits[0]) return hits[0];
    const floor = this.raycaster.intersectObject(this.plane, false);
    return floor[0] ?? null;
  }

  private cellFromHit(hit: THREE.Intersection, adjacent: boolean): { x: number; y: number; z: number } | null {
    const data = hit.object.userData as Partial<ItemVoxel>;
    if (typeof data.x === "number") {
      let x = data.x;
      let y = data.y ?? 0;
      let z = data.z ?? 0;
      if (adjacent && hit.face) {
        const n = hit.face.normal;
        x += Math.sign(n.x);
        y += Math.sign(n.y);
        z += Math.sign(n.z);
      }
      return { x, y, z };
    }
    const p = hit.point;
    return { x: Math.round(p.x), y: 0, z: Math.round(p.z) };
  }

  private apply(hit: THREE.Intersection, erase: boolean) {
    if (erase) {
      const cell = this.cellFromHit(hit, false);
      if (cell && typeof (hit.object.userData as ItemVoxel).x === "number") this.remove(cell.x, cell.y, cell.z);
      return;
    }
    const cell = this.cellFromHit(hit, typeof (hit.object.userData as ItemVoxel).x === "number");
    if (cell) this.place(cell.x, cell.y, cell.z);
  }

  private readonly onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
    this.dragging = false;
    if (e.button !== 2) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.apply(hit, true);
  };

  private readonly onMove = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > TAP) this.dragging = true;
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit || this.erase) {
      this.ghost.visible = false;
      return;
    }
    const cell = this.cellFromHit(hit, typeof (hit.object.userData as ItemVoxel).x === "number");
    if (!cell || !this.inBounds(cell.x, cell.y, cell.z) || this.voxels.has(keyOf(cell.x, cell.y, cell.z))) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.position.set(cell.x, cell.y, cell.z);
    this.ghostMat.color.setHex(ITEM_COLORS[this.kind]);
  };

  private readonly onUp = (e: PointerEvent) => {
    if (this.dragging) return;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > TAP) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;
    const right = e.button === 2 || this.down.button === 2;
    // RMB always deletes. UI place/erase only changes LMB / tap.
    const erase = right || (!right && this.erase);
    this.apply(hit, erase);
  };

  private readonly onLeave = () => {
    this.ghost.visible = false;
  };

  private readonly onMenu = (e: Event) => {
    e.preventDefault();
  };

  private readonly resize = () => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private readonly tick = () => {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
