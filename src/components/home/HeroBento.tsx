import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ViewTransitionLink from '../ViewTransitionLink';
import Icon from '../icons/Icon';
import { isMotionDisabled } from '../../utils/motion';

gsap.registerPlugin(ScrollTrigger);

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
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const exitVeilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isMotionDisabled()) return;

    const section = sectionRef.current;
    const grid = gridRef.current;
    const exitVeil = exitVeilRef.current;
    if (!section || !grid || !exitVeil) return;

    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;

    const context = gsap.context(() => {
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: isDesktop ? '+=110%' : 'bottom top',
          pin: isDesktop,
          anticipatePin: isDesktop ? 1 : 0,
          scrub: 0.8,
          invalidateOnRefresh: true,
        },
      });

      // Treat the bento as one scene: a single focal point and camera move
      // preserve the card geometry through the handoff to the work section.
      timeline.to(
        grid,
        {
          scale: isDesktop ? 1.32 : 1.06,
          yPercent: isDesktop ? -7 : -3,
          transformOrigin: '52% 46%',
          ease: 'none',
        },
        0,
      );
      timeline.to(exitVeil, { opacity: isDesktop ? 0.24 : 0.12, ease: 'none' }, 0.7);
    }, section);

    return () => context.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-screen items-end overflow-hidden bg-altivum-dark px-4 pb-6 pt-24 sm:px-6 sm:pt-28 lg:px-10"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_6%,rgba(46,74,107,0.34),transparent_34%),radial-gradient(circle_at_8%_88%,rgba(197,165,114,0.12),transparent_32%),linear-gradient(145deg,#0a0f1c_4%,#111c2d_58%,#0a0f1c_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(155,166,184,0.11)_1px,transparent_1px),linear-gradient(90deg,rgba(155,166,184,0.11)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]" />
      <div ref={exitVeilRef} className="pointer-events-none absolute inset-0 bg-altivum-dark opacity-0" />

      <div className="relative mx-auto w-full max-w-[108rem] [perspective:1400px]">
        <div
          ref={gridRef}
          className="grid gap-3 sm:gap-4 lg:h-[calc(100svh-8rem)] lg:min-h-[38rem] lg:grid-cols-12 lg:grid-rows-[1fr_1fr_0.78fr] [transform-style:preserve-3d]"
        >
          <article
            data-bento-panel
            className={`${panelClass} flex min-h-[23rem] flex-col justify-between p-7 sm:p-8 lg:col-span-5 lg:row-span-2 lg:min-h-0`}
          >
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(197,165,114,0.1),transparent_42%)]" />
            <div className="relative flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-altivum-gold">
              <span>The Chris Grey</span>
              <span>01 / 03</span>
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
                src="/press-kit/headshots/Professional%20Headshot.png"
                width={1600}
                height={1600}
                alt="Christian Perez"
                loading="eager"
                decoding="sync"
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
