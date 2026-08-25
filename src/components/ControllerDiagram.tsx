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

function ProDPad({ buttons }: { buttons?: ButtonState }) {
  return (
    <g className="diagram-dpad">
      <path d="M178 204h22v22h23v23h-23v23h-22v-23h-23v-23h23Z" />
      <path
        className={buttons?.up ? 'diagram-dpad-segment active' : 'diagram-dpad-segment'}
        d="M178 204h22v38h-22Z"
      />
      <path
        className={buttons?.down ? 'diagram-dpad-segment active' : 'diagram-dpad-segment'}
        d="M178 234h22v38h-22Z"
      />
      <path
        className={buttons?.left ? 'diagram-dpad-segment active' : 'diagram-dpad-segment'}
        d="M155 226h38v23h-38Z"
      />
      <path
        className={buttons?.right ? 'diagram-dpad-segment active' : 'diagram-dpad-segment'}
        d="M185 226h38v23h-38Z"
      />
      <circle cx="189" cy="237.5" r="5" />
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

  if (kind !== 'pro-controller') {
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

  const leftStick = sample?.sticks.left;
  const rightStick = sample?.sticks.right;
  const proStyle = {
    '--controller-body': colors?.body ?? '#2e3038',
    '--controller-buttons': colors?.buttons ?? '#17181d',
    '--controller-left-grip': colors?.leftGrip ?? colors?.body ?? '#464646',
    '--controller-right-grip': colors?.rightGrip ?? colors?.body ?? '#464646',
  } as CSSProperties;
  return (
    <svg
      className="controller-diagram pro-diagram"
      viewBox="0 0 525 446"
      role="img"
      aria-label="Pro Controller live input diagram"
      style={proStyle}
    >
      <g className={buttons?.zl ? 'pro-trigger active' : 'pro-trigger'} data-button="zl">
        <path d="M101 62c5-24 21-38 47-38h29c22 0 36 12 42 36l3 12H103Z" />
        <text x="158" y="47" textAnchor="middle">
          ZL
        </text>
      </g>
      <g className={buttons?.zr ? 'pro-trigger active' : 'pro-trigger'} data-button="zr">
        <path d="M303 72l3-12c6-24 20-36 42-36h29c26 0 42 14 47 38l-2 10Z" />
        <text x="367" y="47" textAnchor="middle">
          ZR
        </text>
      </g>
      <g className={buttons?.l ? 'pro-shoulder active' : 'pro-shoulder'} data-button="l">
        <path d="M121 73c4-15 15-23 30-23h25c16 0 26 8 31 23Z" />
        <text x="164" y="67" textAnchor="middle">
          L
        </text>
      </g>
      <g className={buttons?.r ? 'pro-shoulder active' : 'pro-shoulder'} data-button="r">
        <path d="M313 73c5-15 15-23 31-23h25c15 0 26 8 30 23Z" />
        <text x="356" y="67" textAnchor="middle">
          R
        </text>
      </g>
      <path
        className="controller-body pro-body"
        d="M64 112c7-23 28-39 52-39h293c24 0 45 16 52 39l20 80-102 130H153L50 192Z"
      />
      <path
        className="pro-grip pro-grip-left"
        d="M50 192l103 130-27 73c-9 25-28 40-54 41-22 1-36-9-45-25-9-16-12-28-9-47Z"
      />
      <path
        className="pro-grip pro-grip-right"
        d="M481 192 379 322l27 73c9 25 28 40 54 41 22 1 36-9 45-25 9-16 12-28 9-47Z"
      />
      <path className="pro-body-seam" d="m50 192 103 130h226l102-130" />
      <Stick
        cx={132}
        cy={148}
        x={leftStick?.x}
        y={leftStick?.y}
        pressed={buttons?.leftStick}
        scale={0.76}
      />
      <ProDPad buttons={buttons} />
      <Stick
        cx={313}
        cy={253}
        x={rightStick?.x}
        y={rightStick?.y}
        pressed={buttons?.rightStick}
        scale={0.76}
      />
      <Control cx={376} cy={131} label="X" pressed={buttons?.x} size={17} />
      <Control cx={376} cy={198} label="B" pressed={buttons?.b} size={17} />
      <Control cx={342} cy={165} label="Y" pressed={buttons?.y} size={17} />
      <Control cx={410} cy={165} label="A" pressed={buttons?.a} size={17} />
      <g className={buttons?.minus ? 'diagram-minus-plus active' : 'diagram-minus-plus'}>
        <rect x="237" y="135" width="25" height="7" rx="3.5" />
      </g>
      <g className={buttons?.plus ? 'diagram-minus-plus active' : 'diagram-minus-plus'}>
        <path d="M285 126h7v10h10v7h-10v10h-7v-10h-10v-7h10Z" />
      </g>
      <SymbolButton x={248} y={190} pressed={buttons?.capture} shape="square">
        <circle className="capture-ring" r="7" />
      </SymbolButton>
      <SymbolButton x={282} y={190} pressed={buttons?.home}>
        <path className="home-mark" d="m-7 1 7-6 7 6v7H2V3h-4v5h-5Z" />
      </SymbolButton>
      <g className="pro-player-leds" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <circle key={index} cx={247 + index * 10} cy="218" r="2" />
        ))}
      </g>
      <path className="controller-highlight pro-highlight" d="M79 110c8-15 23-24 42-24h282" />
      <path className="controller-highlight pro-highlight" d="M37 362c-2 21 2 38 13 49" />
      <path className="controller-highlight pro-highlight" d="M488 362c2 21-2 38-13 49" />
    </svg>
  );
}
