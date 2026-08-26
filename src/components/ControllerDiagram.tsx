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
      <circle cx={cx} cy={cy} r={size} />
      <text x={cx} y={cy + 4} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function Stick({
  cx,
  cy,
  x = 0,
  y = 0,
  pressed,
  scale = 1,
}: {
  cx: number;
  cy: number;
  x?: number;
  y?: number;
  pressed?: boolean;
  scale?: number;
}) {
  return (
    <g
      className={pressed ? 'diagram-stick active' : 'diagram-stick'}
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}
    >
      <circle className="stick-well" cx={cx} cy={cy} r="39" />
      <circle className="stick-neck" cx={cx + x * 10} cy={cy - y * 10} r="29" />
      <circle className="stick-cap" cx={cx + x * 10} cy={cy - y * 10} r="22" />
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
        <circle cx={x} cy={y} r="14" />
      ) : (
        <rect x={x - 14} y={y - 14} width="28" height="28" rx="4" />
      )}
      <g transform={`translate(${x} ${y})`}>{children}</g>
    </g>
  );
}

export function ControllerDiagram({
  kind,
  sample,
  colors,
}: {
  kind: ControllerKind;
  sample?: ControllerSample | null;
  colors?: ControllerColors;
}) {
  const left = kind === 'joycon-left';
  const buttons = sample?.buttons;
  const diagramStyle = {
    '--controller-body': colors?.body ?? (left ? '#00c3e3' : '#ff4554'),
    '--controller-buttons': colors?.buttons ?? '#25272d',
  } as CSSProperties;

  const stick = left ? sample?.sticks.left : sample?.sticks.right;
  return (
    <svg
      className="controller-diagram joycon-diagram"
      viewBox="0 0 180 500"
      role="img"
      aria-label={`${left ? 'Left' : 'Right'} Joy-Con live input diagram`}
      style={diagramStyle}
    >
      <g className="diagram-hardware">
        {left ? (
          <>
            <path
              className="controller-body"
              d="M109 34h48c2 0 3 1 3 4v424c0 3-1 4-3 4h-49c-53 0-89-47-89-88V122c0-60 59-88 90-88Z"
            />
            <path
              className="controller-highlight"
              d="M52 51c-15 9-24 22-24 41v309c0 20 9 36 24 46"
            />
            <g className="diagram-rail">
              <rect x="159" y="43" width="17" height="414" rx="3" />
              <path d="M165 58v384" />
              <circle className="rail-sync" cx="168" cy="113" r="3" />
              <rect
                data-button="slLeft"
                className={active(buttons, 'slLeft') ? 'rail-button active' : 'rail-button'}
                x="162"
                y="188"
                width="11"
                height="49"
                rx="5"
              />
              <text x="167.5" y="213" textAnchor="middle" transform="rotate(90 167.5 213)">
                SL
              </text>
              <rect
                data-button="srLeft"
                className={active(buttons, 'srLeft') ? 'rail-button active' : 'rail-button'}
                x="162"
                y="263"
                width="11"
                height="49"
                rx="5"
              />
              <text x="167.5" y="288" textAnchor="middle" transform="rotate(90 167.5 288)">
                SR
              </text>
            </g>
          </>
        ) : (
          <>
            <path
              className="controller-body"
              d="M23 34h48c31 0 90 28 90 88v256c0 41-36 88-89 88H23c-2 0-3-1-3-4V38c0-3 1-4 3-4Z"
            />
            <path
              className="controller-highlight"
              d="M128 51c15 9 24 22 24 41v309c0 20-9 36-24 46"
            />
            <g className="diagram-rail">
              <rect x="4" y="43" width="17" height="414" rx="3" />
              <path d="M15 58v384" />
              <circle className="rail-sync" cx="12" cy="113" r="3" />
              <rect
                data-button="srRight"
                className={active(buttons, 'srRight') ? 'rail-button active' : 'rail-button'}
                x="7"
                y="188"
                width="11"
                height="49"
                rx="5"
              />
              <text x="12.5" y="213" textAnchor="middle" transform="rotate(-90 12.5 213)">
                SR
              </text>
              <rect
                data-button="slRight"
                className={active(buttons, 'slRight') ? 'rail-button active' : 'rail-button'}
                x="7"
                y="263"
                width="11"
                height="49"
                rx="5"
              />
              <text x="12.5" y="288" textAnchor="middle" transform="rotate(-90 12.5 288)">
                SL
              </text>
            </g>
          </>
        )}
      </g>

      {left ? (
        <>
          <g className={buttons?.minus ? 'diagram-minus-plus active' : 'diagram-minus-plus'}>
            <rect x="124" y="65" width="28" height="9" rx="4" />
          </g>
          <Stick cx={88} cy={133} x={stick?.x} y={stick?.y} pressed={buttons?.leftStick} />
          <Control cx={88} cy={229} label="▲" pressed={buttons?.up} />
          <Control cx={88} cy={303} label="▼" pressed={buttons?.down} />
          <Control cx={51} cy={266} label="◀" pressed={buttons?.left} />
          <Control cx={125} cy={266} label="▶" pressed={buttons?.right} />
          <SymbolButton x={88} y={379} pressed={buttons?.capture} shape="square">
            <circle className="capture-ring" r="7" />
          </SymbolButton>
        </>
      ) : (
        <>
          <g className={buttons?.plus ? 'diagram-minus-plus active' : 'diagram-minus-plus'}>
            <path d="M44 55h8v10h10v8H52v10h-8V73H34v-8h10Z" />
          </g>
          <Control cx={104} cy={88} label="X" pressed={buttons?.x} />
          <Control cx={104} cy={162} label="B" pressed={buttons?.b} />
          <Control cx={67} cy={125} label="Y" pressed={buttons?.y} />
          <Control cx={141} cy={125} label="A" pressed={buttons?.a} />
          <Stick cx={104} cy={270} x={stick?.x} y={stick?.y} pressed={buttons?.rightStick} />
          <SymbolButton x={104} y={379} pressed={buttons?.home}>
            <path className="home-mark" d="m-7 1 7-6 7 6v7H2V3h-4v5h-5Z" />
          </SymbolButton>
        </>
      )}
      <g className="diagram-leds">
        {[0, 1, 2, 3].map((index) => (
          <circle key={index} cx={left ? 149 : 31} cy={423 + index * 8} r="2" />
        ))}
      </g>
    </svg>
  );
}
