import { useIsFocused } from 'expo-router/react-navigation';
import { createContext, use, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewProps } from 'react-native';
import { cardColors } from '@/constants/card-styles';
import { FlowBackground } from './flow-background';

type FlowAnchor = { bottom: number; width: number; height: number; fontScale: number };
const FlowLayoutContext = createContext<{
  anchor: FlowAnchor | null;
  recordAnchor: (anchor: FlowAnchor) => void;
}>({ anchor: null, recordAnchor: () => {} });

function sameWindow(a: FlowAnchor, b: Omit<FlowAnchor, 'bottom'>) {
  return a.width === b.width && a.height === b.height && a.fontScale === b.fontScale;
}

function sameFrame(a: FlowAnchor | null, b: FlowAnchor) {
  return a !== null && sameWindow(a, b) && Math.abs(a.bottom - b.bottom) < .5;
}

export function FlowLayout({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<FlowAnchor | null>(null);
  const recordAnchor = useCallback((next: FlowAnchor) => {
    setAnchor(previous => sameFrame(previous, next) ? previous : next);
  }, []);
  const value = useMemo(() => ({ anchor, recordAnchor }), [anchor, recordAnchor]);
  return <FlowLayoutContext value={value}>{children}</FlowLayoutContext>;
}

export function FlowScreen({ children, backgroundTop = 0, reference = false, style, onLayout, ...props }: ViewProps & {
  backgroundTop?: number | null;
  reference?: boolean;
}) {
  const { anchor, recordAnchor } = use(FlowLayoutContext);
  const { width, height, fontScale } = useWindowDimensions();
  const focused = useIsFocused();
  const view = useRef<View>(null);
  const [frame, setFrame] = useState<FlowAnchor | null>(null);
  const measure = useCallback(() => {
    if (!focused) return;
    view.current?.measureInWindow((_x, y, _width, viewHeight) => {
      if (viewHeight <= 0) return;
      const next = { bottom: y + viewHeight, width, height, fontScale };
      setFrame(previous => sameFrame(previous, next) ? previous : next);
      if (reference) recordAnchor(next);
    });
  }, [focused, fontScale, height, recordAnchor, reference, width]);
  useLayoutEffect(measure, [measure]);

  // Match the home screen's actual window position, independent of tab bars and docks.
  const windowSize = { width, height, fontScale };
  const anchorBottom = anchor && sameWindow(anchor, windowSize) ? anchor.bottom : height * .8;
  const backgroundBottom = reference ? 0 : frame && sameWindow(frame, windowSize)
    ? Math.max(0, frame.bottom - anchorBottom) : null;

  return (
    <View {...props} ref={view} onLayout={event => { onLayout?.(event); measure(); }} style={[styles.screen, style]}>
      {backgroundTop !== null && backgroundBottom !== null && <FlowBackground style={{ top: backgroundTop, bottom: backgroundBottom }} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas, overflow: 'hidden' },
});
