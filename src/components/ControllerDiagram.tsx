import type { CSSProperties, ReactNode } from 'react';
import type {
  ButtonState,
  ControllerColors,
  ControllerKind,
  ControllerSample,
} from '../types/controller';

const active = (buttons: ButtonState | undefined, ...keys: (keyof ButtonState)[]) =>
  keys.some((key) => buttons?.[key]);

function Control({
  cx,
  cy,
  label,
  pressed,
  size = 14,
}: {
  cx: number;
  cy: number;
  label: string;
  pressed?: boolean;
  size?: number;
}) {
  return (
    <g className={pressed ? 'diagram-control active' : 'diagram-control'}>
      <circle className="button-bezel" cx={cx} cy={cy} r={size + 2.5} />
      <circle className="button-face" cx={cx} cy={cy} r={size} />
      <text x={cx} y={cy + 4} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function DirectionControl({
  cx,
  cy,
  direction,
  pressed,
}: {
  cx: number;
  cy: number;
  direction: 'up' | 'right' | 'down' | 'left';
  pressed?: boolean;
}) {
  const rotations = { up: 0, right: 90, down: 180, left: 270 };
  return (
    <g
      className={
        pressed ? 'diagram-control diagram-direction active' : 'diagram-control diagram-direction'
      }
    >
      <circle className="button-bezel" cx={cx} cy={cy} r="16.5" />
      <circle className="button-face" cx={cx} cy={cy} r="14" />
      <path
        className="direction-mark"
        d={`M${cx} ${cy - 6}l6 9h-12Z`}
        transform={`rotate(${rotations[direction]} ${cx} ${cy})`}
      />
    </g>
  );
}

function Stick({
  cx,
  cy,
  x = 0,
  y = 0,
  pressed,
}: {
  cx: number;
  cy: number;
  x?: number;
  y?: number;
  pressed?: boolean;
}) {
  const capX = cx + x * 11;
  const capY = cy - y * 11;

  return (
    <g className={pressed ? 'diagram-stick active' : 'diagram-stick'}>
      <circle className="stick-well" cx={cx} cy={cy} r="40" />
      <circle className="stick-well-ring" cx={cx} cy={cy} r="35" />
      <circle className="stick-neck" cx={capX} cy={capY} r="29" />
      <circle className="stick-cap" cx={capX} cy={capY} r="23" />
      <circle className="stick-cap-inset" cx={capX} cy={capY} r="18" />
      <g className="stick-ticks" transform={`translate(${capX} ${capY})`}>
        {Array.from({ length: 8 }, (_, index) => (
          <path key={index} d="M0 -22v5" transform={`rotate(${index * 45})`} />
        ))}
      </g>
    </g>
  );
}

function SymbolButton({
  x,
  y,
  pressed,
  children,
  shape = 'round',
}: {
  x: number;
  y: number;
  pressed?: boolean;
  children: ReactNode;
  shape?: 'round' | 'square';
}) {
  return (
    <g className={pressed ? 'diagram-symbol active' : 'diagram-symbol'}>
      {shape === 'round' ? (
        <>
          <circle className="symbol-bezel" cx={x} cy={y} r="16.5" />
          <circle className="symbol-face" cx={x} cy={y} r="14" />
        </>
      ) : (
        <>
          <rect className="symbol-bezel" x={x - 16.5} y={y - 16.5} width="33" height="33" rx="5" />
          <rect className="symbol-face" x={x - 14} y={y - 14} width="28" height="28" rx="4" />
        </>
      )}
      <g transform={`translate(${x} ${y})`}>{children}</g>
    </g>
  );
}

function FrontShoulder({ left, buttons }: { left: boolean; buttons?: ButtonState }) {
  const shoulderKey = left ? 'l' : 'r';

  return (
    <g className="diagram-front-shoulder">
      <path
        data-button={shoulderKey}
        className={active(buttons, shoulderKey) ? 'diagram-shoulder active' : 'diagram-shoulder'}
        d={
          left
            ? 'm 142.86562,454.00874 0,-4.1875 c 0,-1.25689 -1.28376,-2.65625 -2.65625,-2.65625 l -26.25,0 c -40.493551,0 -76.739828,32.66191 -82.951478,55.8441 -0.28337,1.05756 -0.38499,3.18198 1.4584,3.18198 l 4.66249,0 z'
            : 'm 1056.7015,454.00874 0,-4.1875 c 0,-1.25689 1.2838,-2.65625 2.6563,-2.65625 l 26.25,0 c 40.4935,0 76.7398,32.66191 82.9515,55.8441 0.2833,1.05756 0.385,3.18198 -1.4584,3.18198 l -4.6625,0 z'
        }
        transform={left ? 'translate(0 -412.54757)' : 'translate(-1004 -412.54757)'}
      />
    </g>
  );
}

function FrontRail({ left, buttons }: { left: boolean; buttons?: ButtonState }) {
  const railButtonKeys: readonly [keyof ButtonState, keyof ButtonState] = left
    ? ['slLeft', 'srLeft']
    : ['srRight', 'slRight'];

  return (
    <g className="diagram-front-rail">
      <path
        className="front-rail"
        d={
          left
            ? 'm 178.73015,475.40983 -14.00955,0 0,335.59891 6.55516,0 0,13.9375 c 0,1.5574 1.30818,4.18497 2.41619,4.18497 l 4.88068,0 c 0.89533,0 1.70187,-0.69146 1.70187,-1.70186 l 0,-65.24352 c 0,-8.61907 -5.38924,-8.72486 -5.38924,-11.4463 l 0,-34.60403 c 0,-2.45548 5.25911,-3.05964 5.25911,-10.07628 l 0,-114.55129 c 0,-6.95525 -5.25911,-7.42304 -5.25911,-10.07628 l 0.125,-34.02951 c 0,-2.34388 5.25911,-4.1493 5.25911,-10.38563 l -0.003,-59.80577 c 0.009,-0.98171 -0.47425,-1.80091 -1.53575,-1.80091 z'
            : 'm 1021.2159,475.40983 14.0096,0 0,335.59891 -6.5552,0 0,13.9375 c 0,1.5574 -1.3082,4.18497 -2.4162,4.18497 l -4.8807,0 c -0.8953,0 -1.7018,-0.69146 -1.7018,-1.70186 l 0,-65.24352 c 0,-8.61907 5.3892,-8.72486 5.3892,-11.4463 l 0,-34.60403 c 0,-2.45548 -5.2591,-3.05964 -5.2591,-10.07628 l 0,-114.55129 c 0,-6.95525 5.2591,-7.42304 5.2591,-10.07628 l -0.125,-34.02951 c 0,-2.34388 -5.2591,-4.1493 -5.2591,-10.38563 l 0,-59.80577 c -0.01,-0.98171 0.4742,-1.80091 1.5357,-1.80091 z'
        }
        transform={left ? 'translate(0 -412.54757)' : 'translate(-1004 -412.54757)'}
      />
      {[547.09278, 750.85843].map((y, index) => (
        <path
          key={y}
          data-button={railButtonKeys[index]}
          className={
            active(buttons, railButtonKeys[index]) ? 'front-side-key active' : 'front-side-key'
          }
          d={
            left
              ? index === 0
                ? 'm 178.19982,547.09278 -4.19844,0 0,34.51565 4.11005,0 c 1.43551,0 2.16552,-1.00126 2.16552,-2.16551 l 0,-30.53818 c 0,-1.10492 -0.80847,-1.81196 -2.07713,-1.81196 z'
                : 'm 178.19982,750.85843 -4.19844,0 0,-34.51565 4.11005,0 c 1.43551,0 2.16552,1.00126 2.16552,2.16551 l 0,30.53818 c 0,1.10492 -0.80847,1.81196 -2.07713,1.81196 z'
              : index === 0
                ? 'm 1021.7462,547.09278 4.1985,0 0,34.51565 -4.1101,0 c -1.4355,0 -2.1655,-1.00126 -2.1655,-2.16551 l 0,-30.53818 c 0,-1.10492 0.8085,-1.81196 2.0771,-1.81196 z'
                : 'm 1021.7462,750.85843 4.1985,0 0,-34.51565 -4.1101,0 c -1.4355,0 -2.1655,1.00126 -2.1655,2.16551 l 0,30.53818 c 0,1.10492 0.8085,1.81196 2.0771,1.81196 z'
          }
          transform={left ? 'translate(0 -412.54757)' : 'translate(-1004 -412.54757)'}
        />
      ))}
    </g>
  );
}

function SideView({ left, buttons }: { left: boolean; buttons?: ButtonState }) {
  const triggerKey = left ? 'zl' : 'zr';
  const shoulderKey = left ? 'l' : 'r';
  const upperKey = left ? 'slLeft' : 'srRight';
  const lowerKey = left ? 'srLeft' : 'slRight';
  const railCenterX = left ? 38.91 : 41.09;

  return (
    <g className="diagram-side-view" transform="translate(200 14)">
      <g transform={left ? undefined : 'translate(80 0) scale(-1 1)'}>
        <g transform="translate(-260 -427.36218)">
          <path
            data-button={shoulderKey}
            className={active(buttons, shoulderKey) ? 'side-shoulder active' : 'side-shoulder'}
            d="m 302.46499,454.15243 c 0,0 -21.07254,-0.13475 -21.03643,0 0.0361,0.13475 0,-4.19844 0,-4.19844 0,-1.12766 0.83566,-1.85616 1.85615,-1.85616 l 17.19154,0 c 1.21694,0 1.98874,1.08829 1.98874,1.98874 z"
          />
          <path
            className="side-shell"
            d="m 305.77955,453.04758 -21.59341,0 c -8.28074,0 -13.93871,8.13078 -13.93871,15.55635 l 0,386.96418 c 0,8.71441 6.969,15.29115 15.29119,15.29115 l 19.53382,0 c 12.24072,0 22.93678,-12.54989 22.93678,-22.93674 l 0,-372.60108 c 0,-11.226 -12.87218,-22.27386 -22.22967,-22.27386 z"
          />
          <path
            className="side-shell"
            d="m 327.16142,543.57904 c 0,-19.23002 23.52265,-32.92125 31.375,-50.68749 0.45707,-1.70583 -0.89201,-3.6875 -2.5625,-3.6875 l -9.9375,0 c -15.35249,0 -12.18986,-17.6458 -22.4375,-25.5 l 0,79.89739 z"
          />
          <path
            data-button={triggerKey}
            className={
              active(buttons, triggerKey) ? 'side-trigger-face active' : 'side-trigger-face'
            }
            d="m 315.2371,458.52766 c 10.06719,0 26.19033,9.23967 38.89087,10.42982 2.68979,0 4.50781,2.71034 4.50781,4.77297 l 0,9.01561 c 0,2.99281 -4.33103,5.25007 -4.33103,7.86657 l -33.85274,0 z"
          />
          <path
            className="side-shell-seam"
            d="m 358.47392,481.45405 c -18.72947,0 -22.1406,-5.875 -27.125,-5.875"
          />
          <path
            className="side-key"
            d="m 333.59892,512.57905 -7,0 0,-18.75 7.125,0 c 0.92109,0 1.33679,0.80551 1.53125,1.53125 1.40306,5.2363 1.33195,10.87282 0,15.84375 -0.21,0.78371 -0.73602,1.375 -1.65625,1.375 z"
          />
          <rect
            className="side-rail"
            x="279.52496"
            y="475.47684"
            width="38.6479"
            height="353.35223"
            rx="4.266"
          />
          <rect
            data-button={upperKey}
            className={active(buttons, upperKey) ? 'rail-button active' : 'rail-button'}
            x="291.34894"
            y="546.99408"
            width="15.125"
            height="35.125"
            rx="5.39"
          />
          <rect
            data-button={lowerKey}
            className={active(buttons, lowerKey) ? 'rail-button active' : 'rail-button'}
            x="291.34894"
            y="715.82904"
            width="15.125"
            height="35.125"
            rx="5.39"
          />
          <g className="diagram-leds">
            {[608.57904, 624.95404, 641.70404, 658.07904].map((y) => (
              <rect key={y} x="295.34894" y={y} width="7.375" height="7.375" rx="2.016" />
            ))}
          </g>
          <circle className="side-screw" cx="299.126" cy="686.493" r="5.95" />
          <rect
            className="release-panel"
            x="283.97394"
            y="763.70404"
            width="30"
            height="61.125"
            rx="4.266"
          />
        </g>
        <path className="release-mark" d="M30 341h18l-9 15Z" />
        <path className="release-mark" d="M30 360h18l-9 15Z" />
        <path className="release-mark" d="M30 379h18l-9 15Z" />
      </g>
      <text
        className="rail-label"
        x={railCenterX}
        y="137.2"
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(90 ${railCenterX} 137.2)`}
      >
        {left ? 'SL' : 'SR'}
      </text>
      <text
        className="rail-label"
        x={railCenterX}
        y="306.03"
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(90 ${railCenterX} 306.03)`}
      >
        {left ? 'SR' : 'SL'}
      </text>
      <text className="trigger-label" x={left ? 77 : 3} y="49" textAnchor="middle">
        {left ? 'ZL' : 'ZR'}
      </text>
    </g>
  );
}

export function ControllerDiagram({
  kind,
  sample,
  colors,
  showSideView = false,
}: {
  kind: ControllerKind;
  sample?: ControllerSample | null;
  colors?: ControllerColors;
  showSideView?: boolean;
}) {
  const left = kind === 'joycon-left';
  const buttons = sample?.buttons;
  const diagramStyle = {
    '--controller-body': colors?.body ?? (left ? '#00bbdb' : '#ff5f53'),
    '--controller-buttons': colors?.buttons ?? '#44484c',
  } as CSSProperties;

  const stick = left ? sample?.sticks.left : sample?.sticks.right;
  return (
    <svg
      className={
        showSideView
          ? 'controller-diagram joycon-diagram with-side-view'
          : 'controller-diagram joycon-diagram'
      }
      viewBox={showSideView ? '0 0 305 500' : '0 0 180 500'}
      role="img"
      aria-label={`${left ? 'Left' : 'Right'} Joy-Con live input diagram`}
      style={diagramStyle}
    >
      <FrontShoulder left={left} buttons={buttons} />
      <g className="diagram-hardware">
        {left ? (
          <path
            className="controller-body"
            d="m 165.90787,455.54757 0,412.68749 c 0,1.0235 -0.5059,1.7969 -1.79687,1.7969 l -49.64063,0 c -51.679508,0 -85.074858,-45.69768 -85.074858,-85.07487 l 0,-247.94077 c 0,-57.88508 56.764387,-84.71894 84.718948,-84.71894 l 48.79057,0 c 2.4861,0 3.00284,1.36797 3.00284,3.25019 z"
            transform="translate(0 -412.54757)"
          />
        ) : (
          <path
            className="controller-body"
            d="m 1033.8578,456.16499 0,412.68747 c 0,1.0235 0.5059,1.7969 1.7969,1.7969 l 49.6406,0 c 51.6795,0 85.0749,-45.69766 85.0749,-85.07485 l 0,-247.94077 c 0,-57.88508 -56.7644,-84.71894 -84.719,-84.71894 l -48.7906,0 c -2.4861,0 -3.0028,1.36797 -3.0028,3.25019 z"
            transform="translate(-1004 -412.54757)"
          />
        )}
        <FrontRail left={left} buttons={buttons} />
      </g>

      {left ? (
        <>
          <g className={buttons?.minus ? 'diagram-minus-plus active' : 'diagram-minus-plus'}>
            <rect className="minus-plus-face" x="127" y="79.5" width="23" height="6" rx="1.5" />
          </g>
          <Stick cx={88} cy={145} x={stick?.x} y={stick?.y} pressed={buttons?.leftStick} />
          <DirectionControl cx={88} cy={240} direction="up" pressed={buttons?.up} />
          <DirectionControl cx={88} cy={314} direction="down" pressed={buttons?.down} />
          <DirectionControl cx={51} cy={277} direction="left" pressed={buttons?.left} />
          <DirectionControl cx={125} cy={277} direction="right" pressed={buttons?.right} />
          <SymbolButton x={88} y={394} pressed={buttons?.capture} shape="square">
            <circle className="capture-ring" r="7" />
            <circle className="capture-lens" r="3.5" />
          </SymbolButton>
        </>
      ) : (
        <>
          <g className={buttons?.plus ? 'diagram-minus-plus active' : 'diagram-minus-plus'}>
            <path className="minus-plus-face" d="M52.5 80v-10h5v10h10v5h-10v10h-5v-10h-10v-5Z" />
          </g>
          <Control cx={104} cy={99} label="X" pressed={buttons?.x} />
          <Control cx={104} cy={173} label="B" pressed={buttons?.b} />
          <Control cx={67} cy={136} label="Y" pressed={buttons?.y} />
          <Control cx={141} cy={136} label="A" pressed={buttons?.a} />
          <Stick cx={104} cy={281} x={stick?.x} y={stick?.y} pressed={buttons?.rightStick} />
          <SymbolButton x={104} y={394} pressed={buttons?.home}>
            <circle className="home-ring" r="9" />
            <path className="home-mark" d="m-7 1 7-6 7 6v7H2V3h-4v5h-5Z" />
          </SymbolButton>
        </>
      )}
      {showSideView && <SideView left={left} buttons={buttons} />}
    </svg>
  );
}
