import Image from "next/image";

/**
 * THE FRAME: one screenshot from Sage's own browser, in thin window chrome, with Sage's one-line
 * note under it. Only ever a real field-test step: the picture, the address and the note all come
 * from the run.
 */
export interface FrameProps {
  /** the step's number in the run, from 1 */
  n: number;
  /** the address Sage was on */
  url: string;
  /** the screenshot, served by /api/field-tests/<inspectionId>/<n> */
  src: string;
  /** what Sage did: "Clicked “Enter”" */
  note: string;
  /** what Sage saw, when its eyes described the step */
  saw?: string | null;
  /** above the fold: load it first */
  priority?: boolean;
}

const shortUrl = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname === "/" ? "" : x.pathname}`;
  } catch {
    return u;
  }
};

export function Frame({ n, url, src, note, saw, priority }: FrameProps) {
  return (
    <figure className="sg-shot">
      <div className="sg-shot-win">
        <div className="sg-shot-chrome" aria-hidden>
          <span className="sg-shot-n">{String(n).padStart(2, "0")}</span>
          <span className="sg-shot-url">{shortUrl(url)}</span>
        </div>
        <Image className="sg-shot-img" src={src} alt={`Step ${n}: ${note}`} width={688} height={430} sizes="(min-width: 1144px) 344px, 82vw" priority={priority} />
      </div>
      <figcaption className="sg-shot-note">
        {note}
        {saw ? <span className="sg-shot-saw">{saw}</span> : null}
      </figcaption>
    </figure>
  );
}
