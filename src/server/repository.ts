import type { RepositorySnapshot, RepositorySource } from "@/domain/repository";
import { buildCodeRealityMap, materializeCodeRealityMap, type AnalyzeRepositoryOptions } from "./code-reality";
import { cloneRepository, inspectRepository, type CloneRepositoryOptions } from "./repository-source";

export * from "./code-reality";
export * from "./repository-source";

export async function acquireRepository(source: RepositorySource, cloneOptions?: CloneRepositoryOptions): Promise<RepositorySnapshot> {
  if (source.kind === "remote-git") {
    if (!cloneOptions) throw new Error("Remote Git sources require an explicit clone destination");
    return cloneRepository(source, cloneOptions);
  }
  return inspectRepository(source);
}

export async function analyzeRepositorySource(source: RepositorySource, options: {
  clone?: CloneRepositoryOptions;
  inventory?: AnalyzeRepositoryOptions;
  outputFile?: string;
} = {}) {
  const snapshot = await acquireRepository(source, options.clone);
  const map = options.outputFile
    ? await materializeCodeRealityMap(snapshot, options.outputFile, options.inventory)
    : await buildCodeRealityMap(snapshot, options.inventory);
  return { snapshot, map };
}
