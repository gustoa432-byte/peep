import { button, Leva, useControls } from "leva";
import { ITEM_DEBUG } from "@/lib/peep/item-voxels";

function WeaponSliders() {
  useControls("оружие", {
    "position.x": {
      value: ITEM_DEBUG.x,
      step: 0.01,
      min: -2,
      max: 2,
      onChange: (v) => {
        ITEM_DEBUG.x = v;
      },
    },
    "position.y": {
      value: ITEM_DEBUG.y,
      step: 0.01,
      min: -2,
      max: 2,
      onChange: (v) => {
        ITEM_DEBUG.y = v;
      },
    },
    "position.z": {
      value: ITEM_DEBUG.z,
      step: 0.01,
      min: -3,
      max: 0,
      onChange: (v) => {
        ITEM_DEBUG.z = v;
      },
    },
    "rotation.x": {
      value: ITEM_DEBUG.rx,
      step: 0.01,
      min: -Math.PI,
      max: Math.PI,
      onChange: (v) => {
        ITEM_DEBUG.rx = v;
      },
    },
    "rotation.y": {
      value: ITEM_DEBUG.ry,
      step: 0.01,
      min: -Math.PI,
      max: Math.PI,
      onChange: (v) => {
        ITEM_DEBUG.ry = v;
      },
    },
    "rotation.z": {
      value: ITEM_DEBUG.rz,
      step: 0.01,
      min: -Math.PI,
      max: Math.PI,
      onChange: (v) => {
        ITEM_DEBUG.rz = v;
      },
    },
    scale: {
      value: ITEM_DEBUG.scale,
      step: 0.01,
      min: 0.1,
      max: 3,
      onChange: (v) => {
        ITEM_DEBUG.scale = v;
      },
    },
    "Log Transform": button(() => {
      console.log({
        position: { x: ITEM_DEBUG.x, y: ITEM_DEBUG.y, z: ITEM_DEBUG.z },
        rotation: { x: ITEM_DEBUG.rx, y: ITEM_DEBUG.ry, z: ITEM_DEBUG.rz },
        scale: ITEM_DEBUG.scale,
      });
    }),
  });
  return null;
}

export function WeaponDebug() {
  return (
    <>
      <Leva
        collapsed
        oneLineLabels
        titleBar={{ title: "оружие", filter: false }}
        theme={{
          sizes: { rootWidth: "280px" },
        }}
      />
      <WeaponSliders />
    </>
  );
}
