import { chatMidHelpersPart1 } from "./chatMidHelpersPart1.js";
import { chatMidHelpersPart2 } from "./chatMidHelpersPart2.js";
import { chatMidHelpersPart3 } from "./chatMidHelpersPart3.js";
import { chatMidHelpersPart4 } from "./chatMidHelpersPart4.js";
import { chatMidHelpersPart5 } from "./chatMidHelpersPart5.js";

export function createChatMidHelpers(deps) {
  const p1 = chatMidHelpersPart1(deps);
  const p2 = chatMidHelpersPart2({ ...deps, ...p1 });
  const p3 = chatMidHelpersPart3({ ...deps, ...p1, ...p2 });
  const p4 = chatMidHelpersPart4({ ...deps, ...p1, ...p2, ...p3 });
  const p5 = chatMidHelpersPart5({ ...deps, ...p1, ...p2, ...p3, ...p4 });
  return { ...p1, ...p2, ...p3, ...p4, ...p5 };
}
