import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { configureTextBuilder } from 'troika-three-text';
import * as THREE from 'three';
import type { ClusterData } from '../../data/infrastructureTopology';

/**
 * Self-hosted label font for the in-canvas <Text> labels.
 *
 * drei's <Text> is troika-three-text, which parses font files itself rather than
 * using CSS @font-face. With no `font` prop it resolves one at runtime from
 * https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver — an origin the site's
 * CSP does not allow in connect-src, so every label silently rendered as nothing
 * while the wireframe spheres kept animating. Pointing at a local file keeps the
 * request same-origin (troika fetches the font, so connect-src 'self' covers it —
 * font-src governs @font-face only and is not involved).
 *
 * Must stay .woff, .ttf or .otf: troika parses with Typr and does NOT support
 * .woff2. Manrope Light 300 rather than the 200 used elsewhere in the type scale
 * because these render as SDF at fontSize 0.12–0.2, where hairline strokes break
 * up against the dark background. SIL OFL 1.1 — see manrope-LICENSE.txt.
 */
const LABEL_FONT = '/fonts/manrope-latin-300.woff';

// Troika's worker dynamically imports generated scripts, which the site's CSP blocks.
configureTextBuilder({ useWorker: false });

interface ServiceClusterProps {
  cluster: ClusterData;
  isSelected: boolean;
  onClick: () => void;
}

export function ServiceCluster({ cluster, isSelected, onClick }: ServiceClusterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const baseY = cluster.position[1];

  useFrame(({ clock }) => {
    if (!groupRef.current || isSelected) return;
    const t = clock.elapsedTime;
    groupRef.current.position.y = baseY + Math.sin(t * 1.2) * 0.03;
  });

  const opacity = isSelected ? 0.8 : hovered ? 0.55 : 0.3;

  return (
    <group
      ref={groupRef}
      position={cluster.position}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Wireframe sphere */}
      <mesh>
        <sphereGeometry args={[cluster.size, 16, 16]} />
        <meshBasicMaterial wireframe color="#C5A572" transparent opacity={opacity} />
      </mesh>

      {/* Cluster label */}
      <Text
        font={LABEL_FONT}
        position={[0, cluster.size + 0.15, 0]}
        color={hovered || isSelected ? '#C5A572' : '#9BA6B8'}
        fontSize={0.2}
        anchorX="center"
        anchorY="middle"
      >
        {cluster.label}
      </Text>

      {/* Service count */}
      <Text
        font={LABEL_FONT}
        position={[0, cluster.size + 0.35, 0]}
        color="#9BA6B8"
        fontSize={0.12}
        anchorX="center"
        anchorY="middle"
      >
        {`${cluster.services.length} service${cluster.services.length !== 1 ? 's' : ''}`}
      </Text>
    </group>
  );
}
