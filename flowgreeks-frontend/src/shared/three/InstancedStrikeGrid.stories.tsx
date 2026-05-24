import type { Meta, StoryObj } from "@storybook/react";
import { CanvasPreset } from "./CanvasPreset";
import { InstancedStrikeGrid, type StrikeBar } from "./InstancedStrikeGrid";
import { SpotPivotRig } from "./SpotPivotRig";
import { PostFx } from "./PostFx";

const meta: Meta = {
  title: "three/InstancedStrikeGrid",
  parameters: { layout: "fullscreen" },
};

export default meta;

const generateBars = (n: number, spot: number, span: number): StrikeBar[] => {
  const bars: StrikeBar[] = [];
  for (let i = 0; i < n; i++) {
    const strike = spot - span / 2 + (i / (n - 1)) * span;
    // Synthetic GEX-shaped curve: positive cluster above spot, negative
    // cluster below, dampened tails. Stories must look like trader data,
    // not random noise.
    const d = strike - spot;
    const value =
      Math.exp(-((d - span * 0.15) ** 2) / (2 * (span * 0.1) ** 2)) * 8 -
      Math.exp(-((d + span * 0.18) ** 2) / (2 * (span * 0.12) ** 2)) * 6;
    bars.push({ strike: Math.round(strike), value });
  }
  return bars;
};

const SyntheticScene = ({
  bars,
  spot,
  range,
}: {
  bars: StrikeBar[];
  spot: number;
  range: [number, number];
}) => (
  <CanvasPreset>
    <ambientLight intensity={0.35} />
    <directionalLight position={[6, 10, 4]} intensity={1.1} castShadow />
    <hemisphereLight args={["#7c8cff", "#05070b", 0.4]} />
    <InstancedStrikeGrid bars={bars} spot={spot} strikeRange={range} />
    <gridHelper args={[40, 40, "#1a2030", "#101620"]} position={[0, -0.001, 0]} />
    <SpotPivotRig spot={spot} strikeRange={range} />
    <PostFx />
  </CanvasPreset>
);

type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const spot = 5234;
    const range: [number, number] = [5050, 5400];
    const bars = generateBars(60, spot, range[1] - range[0]);
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <SyntheticScene bars={bars} spot={spot} range={range} />
      </div>
    );
  },
};

export const SparseDomain: Story = {
  render: () => {
    const spot = 5234;
    const range: [number, number] = [5100, 5350];
    const bars = generateBars(20, spot, range[1] - range[0]);
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <SyntheticScene bars={bars} spot={spot} range={range} />
      </div>
    );
  },
};
