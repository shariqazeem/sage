import Link from "next/link";
import { PlacesRail, ProductSort } from "./test-card";

/**
 * AN OPEN TEST, as a tester reads it: the product, what to do, what one try pays, the places left
 * and about how long it takes. Only ever a test someone can be paid for right now.
 */
export interface EarnCardProps {
  href: string;
  /** the product's domain, or the job's title when it has no address */
  product: string;
  /** what to do, in the mission's own words */
  title: string;
  objective?: string | null;
  /** already formatted: "$2.00" */
  each: string;
  placesLeft: number;
  places: number;
  /** "a few minutes" */
  about: string;
}

export function EarnCard({ href, product, title, objective, each, placesLeft, places, about }: EarnCardProps) {
  return (
    <Link href={href} className="sg-card">
      <span className="sg-card-head">
        <ProductSort name={product} />
        <span className="sg-card-domain" data-words={/\s/.test(product) || !product.includes(".") || undefined}>
          {product}
        </span>
        <span className="sg-card-each">
          <b>{each}</b> each
        </span>
      </span>
      <div>
        <p className="sg-card-line">{title}</p>
        {objective ? <p className="sg-card-sub">{objective}</p> : null}
      </div>
      <PlacesRail total={places} paid={Math.max(0, places - placesLeft)} />
      <span className="sg-card-foot">
        <span>
          {placesLeft} of {places} {places === 1 ? "place" : "places"} left
        </span>
        <span>{about}</span>
      </span>
    </Link>
  );
}
