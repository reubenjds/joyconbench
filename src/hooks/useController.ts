import { useCallback, useEffect, useRef, useState } from 'react';
import { NintendoControllerAdapter } from '../adapters/NintendoControllerAdapter';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import type { ControllerIdentity, ControllerSample } from '../types/controller';

export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'disconnected' | 'error';

export function useController() {
  const adapterRef = useRef(new NintendoControllerAdapter());
  const samplesRef = useRef<ControllerSample[]>([]);
  const [latestSample, setLatestSample] = useState<ControllerSample | null>(null);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
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
    setStatus('connecting');
    setError(null);
    try {
      const authorized = await WebHIDTransport.authorizedDevices();
      const connectedIdentity = await adapterRef.current.connect(authorized[0]);
      await adapterRef.current.initialize();
      setIdentity(connectedIdentity);
      setStatus('ready');
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
    await adapterRef.current.disconnect();
    samplesRef.current = [];
    setLatestSample(null);
    setIdentity(null);
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
    connect,
    disconnect,
    error,
    identity,
    latestSample,
    samplesRef,
    status,
    supported: WebHIDTransport.isSupported(),
  };
}
