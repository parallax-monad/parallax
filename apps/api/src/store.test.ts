import { runStoreContract } from "./store.contract.js";
import { InMemoryRunStore } from "./store.js";

runStoreContract("InMemoryRunStore", () => new InMemoryRunStore());
