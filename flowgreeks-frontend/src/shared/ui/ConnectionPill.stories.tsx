import type { Meta, StoryObj } from "@storybook/react";
import { ConnectionPill } from "./ConnectionPill";

const meta: Meta<typeof ConnectionPill> = {
  title: "ui/ConnectionPill",
  component: ConnectionPill,
  parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof ConnectionPill>;

export const Live: Story = { args: { status: "open", lastFrameAgeMs: 432 } };
export const Reconnecting: Story = { args: { status: "reconnecting" } };
export const AuthFailed: Story = { args: { status: "auth-failed" } };
export const Offline: Story = { args: { status: "closed" } };
