"use client";

import "ketcher-react/dist/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ketcher } from "ketcher-core";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";

const structServiceProvider = new StandaloneStructServiceProvider();

export interface StructureEditorApi {
  getSmiles: () => Promise<string>;
  clear: () => Promise<void>;
}

export default function KetcherStructureEditor({
  initialSmiles,
  onReady,
  onChange,
}: {
  initialSmiles: string;
  onReady: (api: StructureEditorApi | null) => void;
  onChange: (smiles: string) => void;
}) {
  const ketcherRef = useRef<Ketcher | null>(null);
  const changeHandlerRef = useRef<(() => void) | null>(null);
  const changeTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readSmiles = useCallback(async (ketcher: Ketcher) => {
    try {
      const smiles = (await ketcher.getSmiles()).trim();
      onChange(smiles);
      setError(null);
      return smiles;
    } catch {
      // An intermediate drawing operation can be chemically incomplete. Keep
      // the last valid preview and let Ketcher finish the edit before retrying.
      return "";
    }
  }, [onChange]);

  const handleInit = useCallback(async (ketcher: Ketcher) => {
    ketcherRef.current = ketcher;
    const api: StructureEditorApi = {
      getSmiles: () => ketcher.getSmiles().then((value) => value.trim()),
      clear: async () => {
        await ketcher.setMolecule("");
        onChange("");
      },
    };
    onReady(api);

    const handleChange = () => {
      if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
      changeTimerRef.current = window.setTimeout(() => {
        changeTimerRef.current = null;
        void readSmiles(ketcher);
      }, 280);
    };
    changeHandlerRef.current = handleChange;
    (ketcher.changeEvent as unknown as { add: (handler: () => void) => void }).add(handleChange);

    try {
      if (initialSmiles.trim()) await ketcher.setMolecule(initialSmiles.trim());
      await readSmiles(ketcher);
    } catch {
      setError("已有结构载入失败，请清除后重新绘制。");
    }
  }, [initialSmiles, onChange, onReady, readSmiles]);

  useEffect(() => () => {
    if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
    const ketcher = ketcherRef.current;
    const handler = changeHandlerRef.current;
    if (ketcher && handler) {
      (ketcher.changeEvent as unknown as { remove: (listener: () => void) => void }).remove(handler);
    }
    onReady(null);
  }, [onReady]);

  return (
    <div className="structure-ketcher-shell" data-testid="ketcher-structure-editor">
      <Editor
        staticResourcesUrl="/"
        structServiceProvider={structServiceProvider}
        disableMacromoleculesEditor
        onInit={handleInit}
        errorHandler={(message) => setError(message || "结构编辑器发生错误。")}
      />
      {error ? (
        <div role="alert" className="absolute inset-x-3 bottom-3 z-20 rounded-[8px] border border-rose-200 bg-white px-3 py-2 text-xs text-rose-700 shadow-card">
          {error}
        </div>
      ) : null}
    </div>
  );
}
