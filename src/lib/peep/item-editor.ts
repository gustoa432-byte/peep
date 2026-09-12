import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  ITEM_COLORS,
  type ItemKind,
  type ItemVoxel,
  serializeItemVoxels,
  writeStoredItem,
} from "./item-voxels";

const HALF = 8;
const TAP = 5;

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
  private readonly voxels = new Map<string, THREE.Mesh>();
  private readonly plane: THREE.Mesh;
  private readonly ghost: THREE.Mesh;
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly mats = new Map<ItemKind, THREE.MeshLambertMaterial>();
  private readonly ghostMat: THREE.MeshLambertMaterial;
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

    this.scene.add(new THREE.AmbientLight(0xfff1dc, 0.7));
    const sun = new THREE.DirectionalLight(0xffd09a, 1.05);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(16, 16, 0xb85c38, 0x3a332c);
    grid.position.set(0, 0, 0);
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(2));

    const planeGeo = new THREE.PlaneGeometry(16, 16);
    planeGeo.rotateX(-Math.PI / 2);
    this.plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.plane);

    this.ghostMat = new THREE.MeshLambertMaterial({
      color: ITEM_COLORS.wood,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(this.box, this.ghostMat);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("contextmenu", this.onMenu);

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
      const { x, y, z, kind } = mesh.userData as ItemVoxel;
      list.push({ x, y, z, kind });
    }
    list.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
    return list;
  }

  toJSON(): string {
    return serializeItemVoxels(this.voxelsList());
  }

  persist() {
    writeStoredItem(this.voxelsList());
    this.onChange?.();
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

  private material(kind: ItemKind): THREE.MeshLambertMaterial {
    let mat = this.mats.get(kind);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color: ITEM_COLORS[kind] });
      this.mats.set(kind, mat);
    }
    return mat;
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= -HALF && x < HALF && z >= -HALF && z < HALF && y >= 0 && y < 16;
  }

  private place(x: number, y: number, z: number) {
    if (!this.inBounds(x, y, z)) return;
    const key = keyOf(x, y, z);
    if (this.voxels.has(key)) return;
    const mesh = new THREE.Mesh(this.box, this.material(this.kind));
    mesh.position.set(x, y, z);
    mesh.userData = { x, y, z, kind: this.kind } satisfies ItemVoxel;
    this.scene.add(mesh);
    this.voxels.set(key, mesh);
    this.persist();
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
    const erase = this.erase || e.button === 2 || this.down.button === 2;
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
