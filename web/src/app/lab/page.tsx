import type { Metadata } from "next";
import BotLab from "./BotLab";

export const metadata: Metadata = { title: "Bot lab · ASCII Poker" };

export default function Lab() {
  return <BotLab />;
}
