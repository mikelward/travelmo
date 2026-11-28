// Explicit type for landmarks.json so TypeScript does not run O(N^2) union
// reduction over hundreds of heterogeneous landmark entries during typecheck.
import type { Landmark } from "./landmarks";

declare const table: { readonly landmarks: readonly Landmark[] };
export default table;
