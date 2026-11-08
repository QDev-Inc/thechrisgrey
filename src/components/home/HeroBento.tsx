import ViewTransitionLink from '../ViewTransitionLink';
import Icon from '../icons/Icon';
import portraitSmall from '../../assets/hero-portrait-480.jpg';
import portraitMedium from '../../assets/hero-portrait-960.jpg';
import portraitLarge from '../../assets/hero-portrait-1280.jpg';

const panelClass =
  'relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-altivum-navy/80 shadow-[0_20px_80px_rgba(0,0,0,0.2)]';

function PanelArrow() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-altivum-gold/35 bg-altivum-dark/40 text-altivum-gold transition duration-300 group-hover:scale-110 group-hover:bg-altivum-gold group-hover:text-altivum-dark">
      <Icon name="north_east" className="text-lg" aria-hidden="true" />
    </span>
  );
}

export default function HeroBento() {
  return (
    <section className="relative flex items-start overflow-hidden bg-altivum-dark px-4 pb-6 pt-24 sm:px-6 sm:pt-28 lg:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_6%,rgba(46,74,107,0.34),transparent_34%),radial-gradient(circle_at_8%_88%,rgba(197,165,114,0.12),transparent_32%),linear-gradient(145deg,#0a0f1c_4%,#111c2d_58%,#0a0f1c_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(155,166,184,0.11)_1px,transparent_1px),linear-gradient(90deg,rgba(155,166,184,0.11)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]" />

      <div className="relative mx-auto w-full max-w-7xl">
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-12 lg:grid-rows-[15rem_15rem_auto]">
          <article
            data-bento-panel
            className={`${panelClass} flex min-h-[23rem] flex-col justify-between p-7 sm:p-8 lg:col-span-5 lg:row-span-2 lg:min-h-0`}
          >
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(197,165,114,0.1),transparent_42%)]" />
            <div className="relative flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-altivum-gold">
              <span>The Chris Grey</span>
              <span>AI · Cloud · Leadership</span>
            </div>

            <div data-bento-title className="relative max-w-md origin-bottom-left">
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-altivum-silver">
                Founder · Operator · Builder
              </p>
              <h1 className="text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-5xl xl:text-6xl">
                Christian Perez
              </h1>
              <p className="mt-6 max-w-sm text-sm leading-relaxed text-altivum-silver sm:text-base">
                Building practical AI systems with the judgment, leadership, and service they require.
              </p>
              <ViewTransitionLink
                to="/contact"
                className="mt-6 inline-flex min-h-12 items-center rounded-lg border border-altivum-gold/60 px-5 py-3 text-sm font-medium text-altivum-gold transition-colors hover:bg-altivum-gold hover:text-altivum-dark"
              >
                Discuss a project <Icon name="arrow_forward" className="ml-3" />
              </ViewTransitionLink>
            </div>

            <div className="relative flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium uppercase tracking-[0.15em] text-altivum-silver">
              <span>AI / Cloud</span>
              <span>Leadership</span>
              <span className="text-altivum-gold">Service</span>
            </div>
          </article>

          <article data-bento-panel className={`${panelClass} min-h-[19rem] lg:col-span-3 lg:row-span-2 lg:min-h-0`}>
            <div data-bento-portrait className="absolute inset-0 origin-center">
              <img
                src={portraitMedium}
                srcSet={`${portraitSmall} 480w, ${portraitMedium} 960w, ${portraitLarge} 1280w`}
                sizes="(min-width: 1024px) 600px, 100vw"
                onError={(event) => {
                  const image = event.currentTarget;
                  if (image.dataset.fallback) return;
                  image.dataset.fallback = 'true';
                  image.removeAttribute('srcset');
                  image.src = '/press-kit/headshots/Professional%20Headshot.png';
                }}
                width={960}
                height={960}
                alt="Christian Perez"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                className="h-full w-full object-cover object-[50%_35%] saturate-[0.72] contrast-110"
                style={{ filter: 'sepia(0.08) brightness(0.82)' }}
              />
              <div className="absolute inset-0 bg-linear-to-t from-altivum-dark via-altivum-dark/10 to-transparent" />
              <div className="absolute inset-0 border-[10px] border-altivum-navy/25" />
            </div>
            <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between">
              <span className="max-w-32 text-xs font-semibold uppercase leading-relaxed tracking-[0.18em] text-white">
                A life in service, applied to systems.
              </span>
              <span className="size-2 rounded-full bg-altivum-gold shadow-[0_0_16px_5px_rgba(197,165,114,0.38)]" />
            </div>
          </article>

          <ViewTransitionLink
            data-bento-panel
            to="/about"
            className={`${panelClass} group flex min-h-36 flex-col justify-between p-5 text-left transition duration-300 hover:border-altivum-gold/55 hover:bg-altivum-blue/45 lg:col-span-4 lg:min-h-0`}
          >
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-altivum-silver">Background</span>
            <p className="max-w-xs text-sm leading-relaxed text-altivum-silver">
              From Green Beret to founder. How a life of service shapes the work I do today.
            </p>
            <span className="flex items-end justify-between gap-4">
              <span className="text-xl font-semibold tracking-[-0.035em] text-white">The story</span>
              <PanelArrow />
            </span>
          </ViewTransitionLink>

          <ViewTransitionLink
            data-bento-panel
            to="/contact"
            className="group relative flex min-h-36 flex-col justify-between overflow-hidden rounded-[1.5rem] bg-altivum-gold p-5 text-left transition duration-300 hover:bg-white lg:col-span-4 lg:min-h-0"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-altivum-dark/70">Connect</span>
            <p className="max-w-xs text-sm leading-relaxed text-altivum-dark/80">
              Speaking, consulting, and thoughtful collaborations. Tell me what you have in mind.
            </p>
            <span className="flex items-end justify-between gap-4">
              <span className="text-xl font-semibold tracking-[-0.035em] text-altivum-dark">Start a conversation</span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-altivum-dark text-altivum-gold transition duration-300 group-hover:scale-110">
                <Icon name="north_east" className="text-lg" aria-hidden="true" />
              </span>
            </span>
          </ViewTransitionLink>

          <a
            data-bento-panel
            href="https://quantumdev.io"
            target="_blank"
            rel="noopener noreferrer"
            className={`${panelClass} group flex min-h-40 flex-col justify-between p-6 transition duration-300 hover:border-altivum-gold/55 hover:bg-altivum-blue/45 lg:col-span-4 lg:min-h-0`}
          >
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-altivum-silver">Studio</span>
            <span className="flex items-end justify-between gap-4">
              <span>
                <span className="block text-2xl font-semibold tracking-[-0.045em] text-white">Q Dev INC.</span>
                <span className="mt-1 block text-sm text-altivum-silver">Explore the work.</span>
              </span>
              <PanelArrow />
            </span>
          </a>

          <ViewTransitionLink
            data-bento-panel
            to="/aws"
            className={`${panelClass} group flex min-h-40 flex-col justify-between p-6 transition duration-300 hover:border-altivum-gold/55 hover:bg-altivum-blue/45 lg:col-span-4 lg:min-h-0`}
          >
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-altivum-silver">Practice</span>
            <span className="flex items-end justify-between gap-4">
              <span>
                <span className="block text-2xl font-semibold tracking-[-0.045em] text-white">AI &amp; Cloud</span>
                <span className="mt-1 block text-sm text-altivum-silver">Strategy grounded in delivery.</span>
              </span>
              <PanelArrow />
            </span>
          </ViewTransitionLink>

          <ViewTransitionLink
            data-bento-panel
            to="/podcast"
            className={`${panelClass} group flex min-h-40 flex-col justify-between p-6 transition duration-300 hover:border-altivum-gold/55 hover:bg-altivum-blue/45 lg:col-span-4 lg:min-h-0`}
          >
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-altivum-silver">Listen</span>
            <span className="flex items-end justify-between gap-4">
              <span>
                <span className="block text-2xl font-semibold tracking-[-0.045em] text-white">The Vector Podcast</span>
                <span className="mt-1 block text-sm text-altivum-silver">Conversations about what matters.</span>
              </span>
              <PanelArrow />
            </span>
          </ViewTransitionLink>
        </div>
      </div>
    </section>
  );
}
