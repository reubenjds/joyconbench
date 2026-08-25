import { useCallback, useEffect, useRef, useState } from 'react';
import { NintendoControllerAdapter } from '../adapters/NintendoControllerAdapter';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import type { ControllerColors, ControllerIdentity, ControllerSample } from '../types/controller';

export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'disconnected' | 'error';

export function useController() {
  const adapterRef = useRef(new NintendoControllerAdapter());
  const samplesRef = useRef<ControllerSample[]>([]);
  const connectionEpochRef = useRef(0);
  const [latestSample, setLatestSample] = useState<ControllerSample | null>(null);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [colors, setColors] = useState<ControllerColors | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = adapterRef.current.subscribe((sample) => {
      samplesRef.current.push(sample);
      if (samplesRef.current.length > 6000) samplesRef.current.splice(0, 1000);
    });
    const visualTimer = window.setInterval(() => {
      const sample = samplesRef.current.at(-1);
      if (sample) setLatestSample(sample);
    }, 33);
    const handleDisconnect = () => setStatus('disconnected');
    navigator.hid?.addEventListener('disconnect', handleDisconnect);
    return () => {
      unsubscribe();
      window.clearInterval(visualTimer);
      navigator.hid?.removeEventListener('disconnect', handleDisconnect);
    };
  }, []);

  const connect = useCallback(async () => {
    const connectionEpoch = ++connectionEpochRef.current;
    setStatus('connecting');
    setError(null);
    setColors(null);
    try {
      const connectedIdentity = await adapterRef.current.connect();
      await adapterRef.current.initialize();
      setIdentity(connectedIdentity);
      setStatus('ready');
      void adapterRef.current
        .readColors()
        .then((detectedColors) => {
          if (connectionEpochRef.current === connectionEpoch) setColors(detectedColors);
        })
        .catch(() => {
          // Appearance is optional; a failed SPI read must not block live diagnostics.
        });
      return connectedIdentity;
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'The controller could not be opened.';
      setError(message);
      setStatus('error');
      throw reason;
    }
  }, []);

  const disconnect = useCallback(async () => {
    connectionEpochRef.current += 1;
    await adapterRef.current.disconnect();
    samplesRef.current = [];
    setLatestSample(null);
    setIdentity(null);
    setColors(null);
    setStatus('idle');
  }, []);

  const capture = useCallback(async (durationMs: number) => {
    const startIndex = samplesRef.current.length;
    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    return samplesRef.current.slice(startIndex);
  }, []);

  return {
    adapter: adapterRef.current,
    capture,
    colors,
    connect,
    disconnect,
    error,
    identity,
    latestSample,
    samplesRef,
    setColors,
    status,
    supported: WebHIDTransport.isSupported(),
  };
}
