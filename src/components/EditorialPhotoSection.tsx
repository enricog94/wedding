export function EditorialPhotoSection() {
  return (
    <section className="editorial-photo" aria-label="Un momento della nostra storia">
      <div className="editorial-photo__media">
        <img
          className="editorial-photo__image"
          src="/images/serena-enrico-editorial.jpg"
          alt="Una coppia sorride con i volti vicini, immersa nella luce tra gli alberi."
          width="2993"
          height="1995"
          loading="lazy"
          decoding="async"
        />
        <p className="editorial-photo__caption">La nostra storia continua qui</p>
      </div>
    </section>
  );
}
