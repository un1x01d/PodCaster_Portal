import { chatPreludeHelpersPart1 } from "./chatPreludeHelpersPart1.js";
import { chatPreludeHelpersPart2 } from "./chatPreludeHelpersPart2.js";
import { chatPreludeHelpersPart3 } from "./chatPreludeHelpersPart3.js";

export function createChatPreludeHelpers(deps) {
  const p1 = chatPreludeHelpersPart1(deps);
  const p2 = chatPreludeHelpersPart2({ ...deps, ...p1 });
  const p3 = chatPreludeHelpersPart3({ ...deps, ...p1, ...p2 });
  return { ...p1, ...p2, ...p3 };
}
