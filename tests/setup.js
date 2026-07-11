process.env.NODE_ENV = "test";

import { generateKeysIfMissing, resetKeyCache } from "../utils/tokens.js";

resetKeyCache();
generateKeysIfMissing();
