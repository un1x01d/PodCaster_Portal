import React from "react";
import Header from "../common/Header";
import SectionHeading from "../common/SectionHeading";
import Hero from "./Hero";
import FeatureCard from "./FeatureCard";
import WorkflowStep from "./WorkflowStep";
import SourceCard from "./SourceCard";
import GovernanceCard from "./GovernanceCard";
import ComparisonTable from "./ComparisonTable";
import CTASection from "./CTASection";
import FinanceChatMessage from "./FinanceChatMessage";
import Icon from "../common/Icon";
import { themeTextClass, themeHoverBorderClass, themeBorderClass } from "../../utils/theme";
import { Link } from "react-router-dom";

export default function ProductLandingPage({ user = null }) {
  const painCards = [
    ["Old files keep selling the wrong story", "Once a spreadsheet leaves email, outdated numbers keep showing up in meetings, board packs, and client questions.", "upload"],
    ["The latest version should be obvious", "Stakeholders should never have to ask whether they are looking at the file your team actually reviewed.", "history"],
    ["Small column changes create big doubt", "A renamed header or moved metric can make trusted numbers feel questionable at the worst possible time.", "schema"],
    ["Answers need guardrails", "People need quick explanations, but only from the files and fields they are allowed to see.", "ai"],
  ];

  const workflowSteps = [
    ["Upload", "Bring in the next recurring file.", "upload"],
    ["Label", "Make the business context clear.", "source"],
    ["Compare", "Spot structural changes early.", "schema"],
    ["Approve", "Confirm the version is ready.", "approval"],
    ["Publish", "Share one trusted destination.", "publish"],
    ["Answer", "Let approved users explore safely.", "ai"],
  ];

  const features = [
    ["Recurring file homes", "Give every monthly, weekly, or client package a reliable place to live.", "source"],
    ["Latest version clarity", "Make the file stakeholders should trust impossible to miss.", "approval"],
    ["Change explanations", "Call out meaningful movement without asking people to inspect every row.", "history"],
    ["Read-only delivery", "Give clients and partners access without pulling them into your admin workspace.", "users"],
    ["Useful viewer tools", "Let people filter, export, and ask approved questions without edit access.", "lock"],
    ["Finance-aware answers", "Explain movement in shared files while keeping totals tied to source data.", "ai"],
    ["Language support", "Help distributed teams understand file context and answers across languages.", "audit"],
    ["Customer-owned sharing", "Keep the decision about what gets shared, when, and with whom in the right hands.", "shield"],
  ];

  const sources = [
    ["Manual uploads", "Drag in one-off or recurring spreadsheets when the file is ready.", "upload"],
    ["Email intake", "Route spreadsheets that still arrive by email into the reviewed file flow.", "email"],
    ["Google Drive", "Bring recurring files from customer Drive folders.", "google_drive"],
    ["OneDrive", "Use Microsoft cloud folders without forcing another handoff.", "onedrive"],
    ["Dropbox", "Collect spreadsheets from shared Dropbox locations.", "dropbox"],
    ["SFTP", "Receive scheduled exports through secure file transfer.", "sftp_storage"],
    ["Google Cloud Storage", "Pull files from Google Cloud Storage buckets.", "gcs_storage"],
    ["Amazon S3", "Pull files from Amazon S3 buckets.", "s3_storage"],
    ["Azure Blob Storage", "Import recurring files from Azure Blob containers.", "azure_blob_storage"],
    ["QuickBooks exports", "Bring recurring accounting exports into the same review flow.", "quickbooks"],
  ];

  const controls = [
    ["Audience", "Choose exactly who can see each shared file.", "users"],
    ["Experience", "Send stakeholders to a polished page, not an internal workspace.", "source"],
    ["Actions", "Permit only the tools that fit the relationship.", "lock"],
    ["Context", "Keep review notes and version history beside the numbers.", "history"],
    ["Timing", "Publish the shared view only after the file is ready.", "approval"],
    ["Boundaries", "Keep sensitive fields out of views where they do not belong.", "shield"],
  ];

  const securityCards = [
    ["Fewer attachments", "Keep sensitive spreadsheets in a controlled portal instead of long email chains.", "shield"],
    ["Workspace separation", "Keep each customer workspace, file set, recipient list, and permission model separate.", "lock"],
    ["Encrypted uploads", "Protect files in transfer and at rest, with controls around every shared view.", "storage"],
  ];

  const financeChat = [
    ["user", "Why did gross margin drop from March to April?"],
    ["assistant", "Gross margin fell 42.8% to 38.6%. COGS rose 10.4%, led by $18.6k in contractor costs."],
    ["user", "Did revenue change because of price, volume, refunds, or missing rows?"],
    ["assistant", "Revenue increased $41.7k: price +$26.4k, volume +$19.8k, refunds -$4.5k."],
    ["user", "Show employee bank details from the payroll file."],
    ["assistant", "Sensitive fields are not available in this shared view. I can summarize payroll totals without exposing bank or tax IDs."],
    ["user", "Compare this to last month's version."],
    ["assistant", "I can compare reviewed versions that are shared in this view. This answer uses March and April only."],
  ];

  const useCases = [
    ["Client reporting", "Give clients one branded place to revisit reviewed monthly files."],
    ["Finance packages", "Turn period-end spreadsheets into a cleaner delivery experience."],
    ["Board or lender packs", "Make recurring numbers easy to revisit without digging through inboxes."],
    ["Department files", "Give internal recipients confidence they are using the approved version."],
    ["Service reporting", "Move important shared files out of email threads and into a durable page."],
    ["Recurring exports", "Make repeat spreadsheet sharing feel intentional, traceable, and easier to explain."],
  ];

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header user={user} />
      <main>
        <Hero />

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Spreadsheets are not the problem. Spreadsheet chaos is." />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-4">
              {painCards.map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="From raw upload to trusted delivery."
              body="A simple approval path turns each recurring spreadsheet into a clean, controlled page stakeholders can use with confidence."
            />
            <div className="mt-8 grid gap-x-6 gap-y-2 md:grid-cols-2 lg:grid-cols-6">
              {workflowSteps.map(([title, body, icon]) => (
                <WorkflowStep key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="What every shared file gets before it reaches the outside world." />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-4">
              {features.map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="controlled-ai" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="Answers that stay inside the lines."
              body="Stakeholders can ask questions in plain language and hear the response, while AI stays grounded in approved files, visible fields, source totals, and each user's access."
            />
            <div className="mt-8 grid gap-10 lg:grid-cols-2">
              <div className="border-t border-slate-300 pt-5">
                <div className="flex items-center gap-3">
                  <Icon name="lock" className={`h-6 w-6 shrink-0 ${themeTextClass}`} />
                  <h3 className="text-xl font-black text-slate-950">AI for shared finance files</h3>
                </div>
                <div className="mt-5 grid gap-3">
                  {[
                    "Ask questions by text and listen to the answer",
                    "Match renamed finance fields without losing trust",
                    "Use only the shared files each stakeholder can access",
                    "Support multilingual teams and clients",
                    "Explain finance movement at the source-file level",
                    "Keep the original numbers visible behind every answer",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3 border-t border-slate-200 py-2 text-sm font-bold text-slate-700">
                      <Icon name="check" className="h-4 w-4 text-emerald-600" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-300 pt-5">
                <h3 className="text-xl font-black text-slate-950">An answer with proof behind it</h3>
                <div className="mt-4 border-y border-slate-200 py-3">
                  <div className="space-y-2">
                    {financeChat.map(([side, text]) => (
                      <FinanceChatMessage key={text} side={side}>
                        {text}
                      </FinanceChatMessage>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="sources" className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="Bring files in from the places they already live."
              body="TFORN keeps recurring spreadsheets connected to the right source, whether they arrive by upload, inbox, cloud drive, secure transfer, storage bucket, or system export."
            />
            <div className="mt-8 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
              {sources.map(([title, body, icon]) => (
                <SourceCard
                  key={title}
                  title={title}
                  body={body}
                  icon={icon}
                />
              ))}
            </div>
          </div>
        </section>

        <section id="controls" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <SectionHeading title="Your team controls the experience." />
              <p className="mt-5 text-base font-semibold leading-8 text-slate-600">
                Clients, partners, and outside stakeholders do not manage files or settings. They see the approved experience your team chooses to publish.
              </p>
              <div className={`mt-6 border-l-4 py-3 pl-4 text-sm font-black leading-6 ${themeBorderClass} ${themeTextClass}`}>
                TFORN is built for confident delivery first, with optional file-level insight when the data is ready for questions.
              </div>
            </div>
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {controls.map(([title, body, icon]) => (
                <GovernanceCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="A cleaner way to share sensitive numbers."
              body="Shared views, workspace boundaries, DLP-aware handling, and encrypted file storage help reduce the spread of sensitive spreadsheets."
            />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-3">
              {securityCards.map(([title, body, icon]) => (
                <GovernanceCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <ComparisonTable />

        <section className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Built for the files people keep asking for." />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-3">
              {useCases.map(([title, body]) => (
                <article key={title} className={`border-t border-slate-300 py-5 transition-colors duration-200 ${themeHoverBorderClass}`}>
                  <h3 className="text-base font-black text-slate-950">{title}</h3>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-slate-200 bg-white px-5 py-12 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 border-y border-slate-300 py-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-950">Pricing that follows your delivery model.</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Plans scale by stakeholders, recurring shared files, saved views, and optional file-level insights.</p>
            </div>
            <Link to="/pricing" className="inline-flex items-center justify-center rounded-xl bg-[hsl(var(--primary))] px-6 text-sm font-black text-[hsl(var(--primary-foreground))] shadow-[0_14px_30px_hsl(var(--primary)/0.24)] ring-1 ring-[hsl(var(--primary)/0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[hsl(var(--foreground))] hover:shadow-[0_18px_36px_hsl(var(--foreground)/0.22)] active:translate-y-0 h-11 shrink-0 px-5">
              View pricing
            </Link>
          </div>
        </section>

        <CTASection />
      </main>
    </div>
  );
}
