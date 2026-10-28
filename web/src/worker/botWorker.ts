// Runs the bots off the main thread so Monte Carlo never drops a frame.
import { BotHost } from "./host";
import type { FromWorker, ToWorker } from "./protocol";

const host = new BotHost();
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    const reply = host.handle(e.data);
    if (reply) post(reply);
  } catch (err) {
    post({ type: "error", reqId: "reqId" in e.data ? e.data.reqId : null, message: String(err) });
  }
};
