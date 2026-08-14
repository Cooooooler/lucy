import { useHookFetch } from 'hook-fetch/react';
import { useCallback, useRef } from 'react';

export function useStream<T = any>(requestFn: (...args: any[]) => any) {
  const dataRef = useRef<T[]>([]);
  const listenersRef = useRef<Set<(data: T[]) => void>>(new Set());

  const { stream, loading, cancel } = useHookFetch({
    request: requestFn,
    onError: (error) => {
      console.error('Stream error:', error);
    },
  });

  const subscribe = useCallback((listener: (data: T[]) => void) => {
    listenersRef.current.add(listener);

    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const startStream = useCallback(
    async (...args: any[]) => {
      dataRef.current = [];

      try {
        for await (const chunk of stream(...args)) {
          if (chunk.result) {
            dataRef.current.push(chunk.result as T);

            // 通知所有监听者
            listenersRef.current.forEach((listener) => {
              listener([...dataRef.current]);
            });
          }
        }
      } catch (error) {
        console.error('Stream processing error:', error);
      }
    },
    [stream],
  );

  const clear = useCallback(() => {
    dataRef.current = [];
    listenersRef.current.forEach((listener) => {
      listener([]);
    });
  }, []);

  return {
    startStream,
    subscribe,
    clear,
    cancel,
    loading,
    data: dataRef.current,
  };
}
