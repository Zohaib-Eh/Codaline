"use client";

import Link from "next/link";
import { ArrowRight, Film, Sparkles, Layers, Volume2 } from "lucide-react";
import { motion } from "framer-motion";

const fade = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } };
const stagger = { show: { transition: { staggerChildren: 0.12 } } };

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── NAV ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5"
        style={{ background: "rgba(28,20,16,0.85)", backdropFilter: "blur(12px)" }}
      >
        <span className="font-display text-xl text-[#F5EDD6] tracking-wide">
          Codaline
        </span>
        <Link
          href="/studio"
          className="flex items-center gap-2 text-sm font-semibold text-[#F5EDD6] border border-white/20 rounded-full px-5 py-2 hover:bg-white/10 transition-all"
        >
          Open Studio <ArrowRight className="w-4 h-4" />
        </Link>
      </nav>

      {/* ── HERO ── */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 overflow-hidden grain"
        style={{ background: "var(--dark-bg)" }}
      >
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute rounded-full opacity-20 blur-3xl"
            style={{ width: 600, height: 600, top: -100, left: -150, background: "radial-gradient(circle, #C4622D 0%, transparent 70%)" }}
          />
          <div
            className="absolute rounded-full opacity-15 blur-3xl"
            style={{ width: 500, height: 500, bottom: -80, right: -100, background: "radial-gradient(circle, #E8A838 0%, transparent 70%)" }}
          />
          <div
            className="absolute rounded-full opacity-10 blur-2xl"
            style={{ width: 300, height: 300, top: "40%", left: "60%", background: "radial-gradient(circle, #C4622D 0%, transparent 70%)" }}
          />
        </div>

        <motion.div
          className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {/* Badge */}
          <motion.div variants={fade} className="mb-8">
            <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-[#E8A838] border border-[#E8A838]/30 rounded-full px-4 py-1.5">
              <Sparkles className="w-3 h-3" /> One-Click Claymation Studio
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={fade}
            className="font-display text-[clamp(3.2rem,9vw,7rem)] leading-[1.0] text-[#F5EDD6] mb-6"
          >
            Your photos.
            <br />
            <span className="italic text-[#C4622D]">Their clay debut.</span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            variants={fade}
            className="text-lg text-[#F5EDD6]/60 max-w-xl mb-10 leading-relaxed"
          >
            Upload a photo, extract your cast, write a story with{" "}
            <span className="text-[#E8A838]">@characters</span>, pick a tone —
            and get back a scored, narrated claymation film.
          </motion.p>

          {/* CTA */}
          <motion.div variants={fade} className="flex items-center gap-4">
            <Link
              href="/studio"
              className="glow-primary inline-flex items-center gap-3 text-base font-bold text-white rounded-full px-8 py-4 transition-all"
              style={{ background: "var(--terracotta)" }}
            >
              Start Creating <ArrowRight className="w-5 h-5" />
            </Link>
            <span className="text-sm text-[#F5EDD6]/40">No account needed</span>
          </motion.div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <div className="w-px h-10 bg-gradient-to-b from-transparent to-white/20" />
          <span className="text-[11px] tracking-widest uppercase text-white/25">Scroll</span>
        </motion.div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-6 py-28 bg-background">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <p className="text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">
              The Process
            </p>
            <h2 className="font-display text-[clamp(2rem,5vw,3.5rem)] leading-tight text-foreground">
              Three steps.
              <br />
              <span className="italic">One film.</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden">
            {[
              {
                icon: <Layers className="w-6 h-6" />,
                num: "01",
                title: "Build Your Cast",
                body: "Upload any photo. Click on objects or people to extract them. Each one gets transformed into a clay character — your bear, your cup, yourself.",
              },
              {
                icon: <Film className="w-6 h-6" />,
                num: "02",
                title: "Write Your Story",
                body: "Type a prompt using @tags to reference your cast. Pick a tone — warm, dark, whimsical, or dramatic. Claude directs the scenes.",
              },
              {
                icon: <Volume2 className="w-6 h-6" />,
                num: "03",
                title: "Watch Your Film",
                body: "Runware animates each scene. ElevenLabs scores and narrates. FFmpeg stitches everything into a final mp4 — ready to download.",
              },
            ].map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card p-10 flex flex-col gap-5"
              >
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    {step.icon}
                  </div>
                  <span className="font-display text-5xl text-border">{step.num}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-foreground mb-2">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STACK CALLOUT ── */}
      <section
        className="px-6 py-20 relative overflow-hidden grain"
        style={{ background: "var(--dark-surface)" }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-10">
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-[#E8A838]/70 mb-3">
              Under the hood
            </p>
            <h2 className="font-display text-3xl md:text-4xl text-[#F5EDD6] leading-tight">
              Real AI.
              <br />
              <span className="italic text-[#C4622D]">Real stop motion.</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {["Claude", "Runware", "SAM2", "ElevenLabs"].map((tech) => (
              <div
                key={tech}
                className="border rounded-xl px-4 py-3 text-center"
                style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}
              >
                <span className="text-sm font-semibold text-[#F5EDD6]/80">{tech}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        className="px-8 py-8 flex items-center justify-between"
        style={{ background: "var(--dark-bg)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <span className="font-display text-lg text-[#F5EDD6]/60">Codaline</span>
        <span className="text-xs text-[#F5EDD6]/30">made with clay ✦</span>
        <Link
          href="/studio"
          className="text-sm font-semibold text-[#C4622D] hover:text-[#E8A838] transition-colors"
        >
          Open Studio →
        </Link>
      </footer>
    </div>
  );
}
