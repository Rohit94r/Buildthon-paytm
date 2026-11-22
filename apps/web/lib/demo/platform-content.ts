// Content topics + variant templates for the platform mock. One TopicSpec renders into every ContentFormat.

import type { ContentFormat, ContentItem, ContentVariant } from "@/lib/platform-types";

export interface TopicSpec {
  key: string;
  title: string;
  summary: string;
  tags: string[];
  source_name: string;
  source_url: string;
  /** One-line hook for social / video. */
  hook: string;
  intro: string;
  sections: [string, string][];
  /** Key figures, one per bullet / tweet. */
  numbers: string[];
  takeaway: string;
  question: string;
  hashtags: string[];
}

export interface BrandContext {
  brand: string;
  persona: string;
  domain: string | null;
  industry: string;
  pathPrefix: string; // e.g. "/markets"
}

/* ------------------------------------------------------------------ */
/* Topics                                                              */
/* ------------------------------------------------------------------ */

export const TOPICS: Record<string, TopicSpec> = {
  rbi_repo: {
    key: "rbi_repo",
    title: "RBI holds repo rate at 6.5% for the ninth straight meeting, keeps 'withdrawal of accommodation' stance",
    summary: "The MPC voted 5–1 to keep the repo rate at 6.5% and trimmed its FY27 inflation forecast to 4.4%, but signalled no rush to cut while food prices stay volatile.",
    tags: ["rbi", "monetary-policy", "interest-rates", "banking"],
    source_name: "RBI press release",
    source_url: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx",
    hook: "RBI just held rates for the ninth time in a row. Here's what it means for your EMI and your portfolio.",
    intro:
      "The Reserve Bank of India left the repo rate unchanged at 6.5% on Friday, its ninth consecutive pause, as the Monetary Policy Committee chose to wait for clearer evidence that food inflation is cooling before it eases. Governor Sanjay Malhotra called growth 'resilient' but said the last mile of disinflation still needs watching.",
    sections: [
      [
        "What the MPC decided",
        "Five of six members voted to hold, with one external member pushing for a 25 basis point cut. The standing deposit facility stays at 6.25% and the marginal standing facility at 6.75%. The committee kept its stance at 'withdrawal of accommodation', which tells the market that a cut in December is possible but not pencilled in. Bond yields barely moved: the 10-year benchmark closed at 6.71%, two basis points lower on the day.",
      ],
      [
        "Why it matters for borrowers and banks",
        "Home and car loan EMIs linked to the repo rate stay where they are for now. Banks had already priced in a pause, so expect little change in deposit rates this quarter. Rate-sensitive stocks reacted calmly: the Nifty Bank index ended 0.4% higher, led by private lenders, while realty stocks slipped as hopes of an early cut faded.",
      ],
      [
        "The inflation math",
        "The RBI trimmed its FY27 CPI forecast to 4.4% from 4.6% and kept GDP growth at 7.0%. Core inflation is running near 3.5%, but vegetable prices remain the swing factor. Most economists we spoke to now expect the first cut in February, provided the monsoon-hit kharif harvest arrives on time.",
      ],
    ],
    numbers: ["Repo rate: 6.5% (unchanged, 9th pause)", "MPC vote: 5–1 to hold", "FY27 CPI forecast cut to 4.4% from 4.6%", "GDP growth forecast held at 7.0%"],
    takeaway: "A pause with a softer tone: the RBI is opening the door to a cut, not walking through it yet. Borrowers should not expect relief before February.",
    question: "Will the RBI cut in December or wait until February? Tell us your call.",
    hashtags: ["RBIPolicy", "RepoRate", "IndianEconomy"],
  },
  sensex_85k: {
    key: "sensex_85k",
    title: "Sensex crosses 85,000 for the first time as Nifty hits a record 26,050",
    summary: "Banks, IT and FII buying pushed both benchmarks to lifetime highs; the Sensex gained 812 points and the Nifty closed at 26,050.",
    tags: ["sensex", "nifty", "stock-market", "fii"],
    source_name: "BSE / NSE closing data",
    source_url: "https://www.bseindia.com/markets.html",
    hook: "Sensex 85,000. Nifty 26,000+. Both at all-time highs today — and the rally is broader than it looks.",
    intro:
      "India's benchmarks closed at record highs on Wednesday. The Sensex rose 812 points, or 0.96%, to 85,214, crossing 85,000 for the first time, while the Nifty 50 gained 238 points to finish at 26,050. Foreign investors were net buyers for a sixth straight session and the rupee firmed to 83.62 against the dollar.",
    sections: [
      [
        "Who drove the rally",
        "Financials did the heavy lifting: HDFC Bank, ICICI Bank and Axis Bank together added more than 300 points to the Sensex. IT stocks extended their post-earnings run, with Infosys up 2.1% after a large deal win. Market breadth was healthy, with 2,410 stocks advancing against 1,530 declining on the NSE.",
      ],
      [
        "The money behind it",
        "Provisional exchange data show foreign portfolio investors bought shares worth ₹3,120 crore on the day, while domestic institutions added ₹1,480 crore. SIP inflows have stayed above ₹26,000 crore a month, giving the market a steady domestic bid even when global cues turn shaky.",
      ],
      [
        "Is it stretched?",
        "The Nifty now trades at about 21.8 times one-year forward earnings, above its 10-year average of 19.5. Analysts say valuations are full but not frothy for large caps; the bigger risk sits in small caps, where the index is up 34% this year. Volatility, as measured by India VIX, remains low at 12.4.",
      ],
    ],
    numbers: ["Sensex: 85,214 (+812 pts, +0.96%)", "Nifty 50: 26,050 (+238 pts)", "FPI net buying: ₹3,120 crore", "India VIX: 12.4"],
    takeaway: "Records driven by banks and steady foreign buying are healthier than a narrow, momentum-only rally, but large-cap valuations leave little room for disappointment in Q3 earnings.",
    question: "Are you adding at these levels or booking profits?",
    hashtags: ["Sensex", "Nifty", "StockMarketIndia"],
  },
  avanti_ipo: {
    key: "avanti_ipo",
    title: "Avanti Green Energy IPO subscribed 38x on final day; QIB portion booked 92x",
    summary: "The ₹1,850 crore solar IPO drew bids worth over ₹52,000 crore, led by institutions; grey market premium points to a 24% listing gain.",
    tags: ["ipo", "renewable-energy", "primary-market"],
    source_name: "NSE IPO bidding data",
    source_url: "https://www.nseindia.com/market-data/all-upcoming-issues-ipo",
    hook: "₹52,000 crore of bids for a ₹1,850 crore IPO. Avanti Green Energy closed 38x subscribed.",
    intro:
      "The initial public offering of Avanti Green Energy, a Pune-based solar developer, was subscribed 38.2 times on its final day of bidding, according to NSE data. The ₹1,850 crore issue, priced at ₹312–328 a share, attracted bids worth more than ₹52,000 crore, making it one of the most heavily subscribed energy listings this year.",
    sections: [
      [
        "Who bid",
        "Qualified institutional buyers carried the issue, bidding 92.4 times their quota. Non-institutional investors subscribed 41.7 times and retail investors 9.8 times. The company had raised ₹555 crore from 24 anchor investors, including two sovereign funds, a day before the issue opened.",
      ],
      [
        "What the money is for",
        "Of the proceeds, ₹1,200 crore is a fresh issue that will fund 1.1 GW of new solar and hybrid capacity in Maharashtra and Rajasthan and repay part of its ₹2,400 crore debt. The rest is an offer for sale by the promoter family and an early private equity backer.",
      ],
      [
        "Listing day expectations",
        "Unlisted market dealers quote a grey market premium of about ₹78, implying a listing near ₹406, roughly 24% above the upper band. Allotment is expected on Thursday and shares list on Monday on both exchanges. At the upper band the issue values the company at around 34 times FY26 earnings, a premium to listed peers.",
      ],
    ],
    numbers: ["Overall subscription: 38.2x", "QIB: 92.4x · NII: 41.7x · Retail: 9.8x", "Price band: ₹312–328, issue size ₹1,850 crore", "Grey market premium: ~₹78 (≈24%)"],
    takeaway: "Institutions are paying up for operating renewable capacity. Retail allottees should note the rich valuation before treating the listing pop as a reason to hold.",
    question: "Did you apply? Hold after listing or sell on day one?",
    hashtags: ["IPO", "AvantiGreenEnergy", "RenewableEnergy"],
  },
  fii_rupee: {
    key: "fii_rupee",
    title: "FIIs pull ₹9,800 crore in a week as rupee slips to 84.10 against the dollar",
    summary: "A stronger dollar and rising US yields triggered foreign selling in Indian equities; the RBI is seen defending the rupee near 84.",
    tags: ["fii", "rupee", "forex", "stock-market"],
    source_name: "NSDL FPI data",
    source_url: "https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx",
    hook: "Foreign investors sold ₹9,800 crore of Indian stocks this week. The rupee felt it.",
    intro:
      "Foreign institutional investors sold a net ₹9,800 crore of Indian equities over the past five sessions, according to NSDL data, as a rebound in US Treasury yields pulled money back to dollar assets. The rupee weakened to 84.10 per dollar on Friday, its lowest close in seven weeks, before suspected RBI dollar sales capped the slide.",
    sections: [
      [
        "Where the selling hit",
        "Financials and IT bore the brunt. FIIs trimmed positions in large private banks after a strong run and sold IT stocks ahead of US holiday-season spending data. Domestic institutions absorbed most of the supply, buying ₹11,200 crore over the same period, which kept the Nifty within 1.5% of its record.",
      ],
      [
        "The rupee and the RBI",
        "Dealers said the central bank sold dollars through state-run banks around 84.05–84.10 to smooth volatility. India's forex reserves of about $688 billion give the RBI room to lean against sharp moves without targeting a level. Importers rushed to hedge, while exporters held back dollar sales expecting a weaker rupee.",
      ],
      [
        "What to watch next week",
        "US inflation data on Wednesday is the key trigger for yields. A softer print could bring foreign buyers back quickly, as happened in September. Closer to home, the monthly GST collection figure and the Q2 GDP release at month-end will shape the growth narrative foreign funds are betting on.",
      ],
    ],
    numbers: ["FII net selling (5 sessions): ₹9,800 crore", "DII net buying: ₹11,200 crore", "USD/INR: 84.10, a 7-week low for the rupee", "Forex reserves: ~$688 billion"],
    takeaway: "This looks like a yield-driven pause, not an exit: domestic flows are absorbing the selling, and the RBI has the reserves to keep the rupee orderly.",
    question: "Is FII selling a buying opportunity for you, or a warning sign?",
    hashtags: ["FII", "Rupee", "IndianMarkets"],
  },
  bank_nifty_psu: {
    key: "bank_nifty_psu",
    title: "Bank Nifty hits a record as PSU lenders rally on strong Q2 asset quality",
    summary: "State-run banks led the gains after SBI and Bank of Baroda reported their lowest gross NPA ratios in a decade.",
    tags: ["bank-nifty", "psu-banks", "earnings"],
    source_name: "NSE sector indices",
    source_url: "https://www.nseindia.com/market-data/live-equity-market",
    hook: "PSU banks just pushed Bank Nifty to an all-time high. Asset quality is the story.",
    intro:
      "The Nifty Bank index closed at a record 55,480 on Tuesday, up 1.3%, as public sector lenders rallied after a run of strong September-quarter results. The Nifty PSU Bank index jumped 3.8%, its best day in four months.",
    sections: [
      ["The results that moved the market", "SBI reported a gross NPA ratio of 2.1%, its lowest in more than a decade, while Bank of Baroda's fell to 2.4%. Both beat estimates on net interest margins despite rising deposit costs."],
      ["Valuations still look modest", "Even after the rally, PSU banks trade at about 1.1 times book value against 2.6 times for large private peers, which analysts say leaves room for re-rating if credit growth holds near 14%."],
      ["The risk", "Unsecured retail loans remain the watch item. The RBI's higher risk weights are slowing growth in personal loans and cards, and any uptick in slippages would hit sentiment quickly."],
    ],
    numbers: ["Bank Nifty: 55,480 (+1.3%, record close)", "Nifty PSU Bank: +3.8%", "SBI gross NPA: 2.1%", "PSU banks at ~1.1x book value"],
    takeaway: "Clean balance sheets are finally showing up in PSU bank valuations; credit growth is now the number to watch.",
    question: "PSU or private banks for the next year?",
    hashtags: ["BankNifty", "PSUBanks", "Q2Results"],
  },
  it_earnings: {
    key: "it_earnings",
    title: "IT majors beat Q2 estimates as deal wins offset weak discretionary spending",
    summary: "Infosys raised its revenue guidance and TCS reported $8.6 billion in new deals, lifting the Nifty IT index 2.4%.",
    tags: ["it-stocks", "earnings", "infosys", "tcs"],
    source_name: "Company filings",
    source_url: "https://www.bseindia.com/corporates/ann.html",
    hook: "Infosys raised guidance. TCS signed $8.6B in deals. IT is back in favour — for now.",
    intro:
      "India's largest IT services firms reported September-quarter results ahead of street estimates, helped by large cost-takeout deals even as clients kept discretionary projects on hold. The Nifty IT index rose 2.4% on the day.",
    sections: [
      ["Guidance up, cautiously", "Infosys lifted its FY27 constant-currency revenue growth guidance to 3–4% from 2.5–4%. TCS reported total contract value of $8.6 billion, its best in five quarters."],
      ["Margins held", "Operating margins were stable despite wage hikes, as utilisation improved and subcontracting costs fell. Attrition stayed near 13%."],
      ["What's next", "Managements flagged GenAI-led productivity deals as a growing share of the pipeline, but warned that US banking and retail clients remain cautious into the holiday quarter."],
    ],
    numbers: ["Nifty IT: +2.4% on the day", "Infosys FY27 guidance: 3–4%", "TCS deal wins: $8.6 billion", "Attrition: ~13%"],
    takeaway: "Deal momentum is real, but growth is still coming from cost-cutting work rather than new spending.",
    question: "Is it time to add IT stocks back to your portfolio?",
    hashtags: ["ITStocks", "Infosys", "Q2Earnings"],
  },
  jee_cutoffs: {
    key: "jee_cutoffs",
    title: "JEE Advanced 2026 cutoffs: what it takes to get into IIT Bombay vs IIT Delhi",
    summary: "Closing ranks for computer science at both IITs stayed under 120 in 2025; here's how the branches, fees and placements compare before you fill JoSAA choices.",
    tags: ["jee-advanced", "iit-bombay", "iit-delhi", "josaa", "admissions"],
    source_name: "JoSAA 2025 opening and closing ranks",
    source_url: "https://josaa.admissions.nic.in/applicant/seatmatrix/openingclosingrankarchieve.aspx",
    hook: "IIT Bombay CSE closed at AIR 66 last year. IIT Delhi at AIR 116. Here's what that means for your JoSAA list.",
    intro:
      "Every June, the same question fills counsellors' inboxes: IIT Bombay or IIT Delhi? Both sit in the top three of the NIRF engineering ranking and both send graduates to the same recruiters. The difference shows up in closing ranks, campus life and a few branches where one clearly leads.",
    sections: [
      [
        "Closing ranks you should know",
        "In JoSAA 2025, computer science at IIT Bombay closed at an all-India rank of 66 for the general category, against 116 at IIT Delhi. Electrical engineering closed near 470 at Bombay and 610 at Delhi. Mechanical and civil are far more accessible, closing in the 2,000–4,500 range at both institutes, which matters if the IIT tag is your priority over the branch.",
      ],
      [
        "Fees and placements side by side",
        "Total programme fees are almost identical at about ₹9 lakh for four years, before hostel and mess. In our CollegeCompass dataset, IIT Bombay reports an average package of 23.5 LPA and an 88% placement rate, while IIT Delhi reports 22.8 LPA and 87%. Fee waivers for families earning under ₹5 lakh a year apply at both.",
      ],
      [
        "How to order your JoSAA choices",
        "If your rank is under 150, list CSE at Bombay first and Delhi second; the difference in outcomes is small, so let city and research interests decide. Between 500 and 3,000, consider whether a core branch at Bombay or Delhi beats CSE at a newer IIT for you. Always fill more choices than you think you need: freezing late costs nothing.",
      ],
    ],
    numbers: ["IIT Bombay CSE closing rank (2025): AIR 66", "IIT Delhi CSE closing rank (2025): AIR 116", "Total fees: ~₹9 lakh at both", "Average package: 23.5 LPA (Bombay) vs 22.8 LPA (Delhi)"],
    takeaway: "For top-150 ranks the choice is personal, not financial. Below that, branch matters more than which of the two IITs you pick.",
    question: "Which would you pick: IIT Bombay or IIT Delhi?",
    hashtags: ["JEEAdvanced", "JoSAA", "IIT"],
  },
  bits_vs_vit: {
    key: "bits_vs_vit",
    title: "BITS Pilani vs VIT Vellore: fees, placements and return on investment",
    summary: "BITS costs about ₹6 lakh more over four years but reports roughly double VIT's average package. We compare fees, placements and admission routes.",
    tags: ["bits-pilani", "vit-vellore", "private-colleges", "admissions"],
    source_name: "CollegeCompass college dataset",
    source_url: "https://collegecompass.in/colleges",
    hook: "BITS Pilani costs ₹6 lakh more than VIT Vellore. Is it worth it? Let's run the numbers.",
    intro:
      "For students who miss the IIT cut, BITS Pilani and VIT Vellore are the two private names that come up most. One admits through BITSAT with a few thousand seats; the other through VITEEE with many more. Here is how they compare on cost, outcomes and the return on what you pay.",
    sections: [
      [
        "What you pay",
        "BITS Pilani's total tuition for four years comes to about ₹21.5 lakh, while VIT Vellore's category-1 fees total around ₹7.8 lakh, rising to ₹17 lakh or more in higher fee categories. Hostel costs are comparable at both. The real VIT cost depends heavily on which category your VITEEE rank lands you in.",
      ],
      [
        "What you earn",
        "In our dataset, BITS Pilani reports an average package of 21 LPA with a 92% placement rate. VIT Vellore reports 9.2 LPA and 89%, with a far larger batch. The highest packages at both run well above 50 LPA, but averages tell you more about a typical outcome than headline offers do.",
      ],
      [
        "The ROI view",
        "Divide total fees by the average first-year salary: BITS pays back in about one year of gross salary, VIT category-1 in under one year, and higher VIT categories in close to two. BITS wins on outcomes; VIT category-1 wins on value. Higher VIT fee categories are the hardest to justify on numbers alone.",
      ],
    ],
    numbers: ["Total fees: ~₹21.5 lakh (BITS) vs ~₹7.8 lakh (VIT cat-1)", "Average package: 21 LPA vs 9.2 LPA", "Placement rate: 92% vs 89%", "NIRF 2026: #20 (BITS) vs #11 (VIT)"],
    takeaway: "If you clear BITSAT for a branch you like, BITS is the stronger bet. If VIT offers you category-1 fees, it is excellent value.",
    question: "BITS or VIT: what would you choose, and why?",
    hashtags: ["BITSPilani", "VIT", "EngineeringAdmissions"],
  },
  josaa_rounds: {
    key: "josaa_rounds",
    title: "JoSAA 2026 counselling: six rounds, key dates and how float, slide and freeze work",
    summary: "A plain-English guide to JoSAA's seat allotment rounds, with the decisions you'll need to make after each one.",
    tags: ["josaa", "counselling", "admissions"],
    source_name: "JoSAA business rules",
    source_url: "https://josaa.nic.in/",
    hook: "Freeze, float or slide? Pick wrong and you could lose a better seat. Here's the 60-second version.",
    intro:
      "JoSAA allots seats at the IITs, NITs, IIITs and other government-funded institutes over six rounds. After each round you choose to freeze, float or slide, and that one decision decides whether you can still move up.",
    sections: [
      ["Freeze", "Accept the seat and exit all later rounds. Choose this only if it is your first preference or you are certain you would not take anything else."],
      ["Float", "Keep the seat but stay eligible for any higher choice on your list, in any institute. This is the default for most students in early rounds."],
      ["Slide", "Keep the seat and only look for a better branch in the same institute. Useful when you love the campus but want a different branch."],
    ],
    numbers: ["6 allotment rounds", "Seat acceptance fee: ₹35,000 (₹17,500 SC/ST/PwD)", "Document upload within 48 hours of allotment"],
    takeaway: "Float early, decide late: there is rarely a reason to freeze before round 4 unless you got your top choice.",
    question: "Which round did you finally freeze in?",
    hashtags: ["JoSAA", "JEE", "Counselling"],
  },
  chief_ai_officer: {
    key: "chief_ai_officer",
    title: "Why boards are hiring Chief AI Officers, and why half the appointments fail in 18 months",
    summary: "The CAIO title is spreading fast in FTSE and Fortune 500 boardrooms. The executives who succeed own a P&L outcome, not a technology roadmap.",
    tags: ["leadership", "ai-strategy", "boardroom"],
    source_name: "Executive search briefings",
    source_url: "https://theexecutivenarrative.com/leadership",
    hook: "One in four large companies now has a Chief AI Officer. Most of them have no budget.",
    intro:
      "The Chief AI Officer has gone from novelty to near-standard in two years. Search firms report that roughly a quarter of FTSE 100 and Fortune 500 companies now have someone with the title or an equivalent remit. Yet the same firms say many appointments are struggling, and the pattern behind the failures is consistent.",
    sections: [
      ["Mandate before title", "The CAIOs who last are given one or two business outcomes, such as cutting claims-handling time or lifting conversion, with a budget to match. Those hired to 'own AI' across the company drift into governance committees and pilot sprawl."],
      ["Where they sit matters", "Reporting to the CEO rather than the CIO signals that AI is a commercial priority, not an IT project. Boards are also adding AI expertise among non-executives so that the CAIO is challenged by people who understand the trade-offs."],
      ["What boards should ask", "Before appointing, chairs should ask which P&L line the role will move in 12 months, who owns the data the role depends on, and what the company will stop doing to fund it."],
    ],
    numbers: ["~25% of large companies have a CAIO or equivalent", "Typical tenure of failed appointments: under 18 months", "Most successful CAIOs report to the CEO"],
    takeaway: "Hire for an outcome with a budget, not for a title. A CAIO without a P&L target becomes a chief pilot officer.",
    question: "Does your board have a clear mandate for AI leadership?",
    hashtags: ["Leadership", "AIStrategy", "Boardroom"],
  },
  board_succession: {
    key: "board_succession",
    title: "CEO succession is getting faster, and boards are less ready than they think",
    summary: "Average CEO tenure has fallen below seven years; succession plans written for a decade-long tenure are out of date.",
    tags: ["leadership", "succession", "governance"],
    source_name: "Governance research roundup",
    source_url: "https://theexecutivenarrative.com/governance",
    hook: "CEO tenure is shrinking. Most succession plans still assume a decade.",
    intro: "Chief executives are leaving sooner than they used to, and boards are discovering that their succession plans were written for a different era.",
    sections: [
      ["Shorter tenures", "Median tenure among large listed companies has fallen to under seven years, with activist pressure and faster strategy cycles shortening it further."],
      ["The bench problem", "Internal candidates are often a decade from readiness when the moment arrives, pushing boards toward expensive external hires."],
      ["What good looks like", "The best boards review succession at every meeting, rotate internal candidates through P&L roles early and keep an emergency successor named at all times."],
    ],
    numbers: ["Median CEO tenure: under 7 years", "External hires cost 20–30% more on average"],
    takeaway: "Succession is a standing agenda item, not a once-a-decade project.",
    question: "When did your board last discuss succession?",
    hashtags: ["Governance", "Leadership", "CEO"],
  },
  hackathon_roundup: {
    key: "hackathon_roundup",
    title: "AI hackathons closing this month: prizes, dates and who can apply",
    summary: "Three online AI hackathons close registrations this month. Here's what each one offers and how to choose.",
    tags: ["hackathons", "ai", "students"],
    source_name: "HackFinder listings",
    source_url: "https://hackfinder.dev/hackathons",
    hook: "Three online AI hackathons close this month. Combined prize pool: over ₹10 lakh.",
    intro: "If you want to build with LLMs this month, you don't need to travel. Three online hackathons close registrations in the coming weeks, each with a different flavour.",
    sections: [
      ["Pick by theme", "Agentic workflows, GenAI for Indian languages and responsible AI are the three themes on offer. Choose the one where you already have a project idea."],
      ["Check eligibility", "Two are open to all students; one requires at least one woman on every team."],
      ["Plan your team", "Teams of two to four do best. Register early: shortlisting often starts before the deadline."],
    ],
    numbers: ["3 online AI hackathons", "Prize pools from ₹1.5 lakh to ₹5 lakh", "Team size: 2–4"],
    takeaway: "Register this week, then spend the time before kickoff on your idea and data.",
    question: "Which one are you joining?",
    hashtags: ["Hackathon", "GenAI", "BuildInPublic"],
  },
  blog_generic: {
    key: "blog_generic",
    title: "Core Web Vitals in 2026: the three fixes that move rankings",
    summary: "Interaction to Next Paint is now the metric most sites fail. These three fixes cover most cases.",
    tags: ["seo", "performance", "web-vitals"],
    source_name: "Search Central updates",
    source_url: "https://developers.google.com/search/updates",
    hook: "Most sites now fail one Core Web Vital: INP. Three fixes cover 80% of cases.",
    intro: "Interaction to Next Paint replaced First Input Delay as a Core Web Vital, and it is the one most sites now fail. The fixes are less exotic than they sound.",
    sections: [
      ["Break up long tasks", "Any script that runs longer than 50 ms blocks the next interaction. Split work and yield to the main thread."],
      ["Defer third-party scripts", "Chat widgets, tag managers and A/B testing tools are the usual culprits. Load them after the first interaction."],
      ["Render less", "Large DOMs make every interaction slower. Paginate long lists and lazy-render below-the-fold components."],
    ],
    numbers: ["Good INP: under 200 ms", "Long task threshold: 50 ms"],
    takeaway: "Fix your slowest interaction first; it usually points at the script to defer.",
    question: "What's your site's INP today?",
    hashtags: ["SEO", "WebPerformance", "CoreWebVitals"],
  },
  ecommerce_generic: {
    key: "ecommerce_generic",
    title: "Festive sale tracker: the biggest real price drops this week",
    summary: "We tracked prices for two weeks before the sale: these discounts are real, not inflated MRPs.",
    tags: ["deals", "price-tracker", "festive-sale"],
    source_name: "Price watch dataset",
    source_url: "https://example.com/deals",
    hook: "We tracked prices for 14 days. Only these discounts are real.",
    intro: "Sale banners promise 70% off, but many 'discounts' are measured against inflated MRPs. Our price watch compares against the actual price two weeks ago.",
    sections: [
      ["Real drops", "Wireless earbuds and air fryers show the deepest genuine cuts, 25–35% below their two-week average."],
      ["Fake drops", "Several televisions show 'sale prices' identical to their pre-sale price."],
      ["When to buy", "Prices usually dip again on the last day of the sale for slow-moving stock."],
    ],
    numbers: ["Deepest real drop: 35%", "Products tracked: 120"],
    takeaway: "Compare with the two-week price, not the MRP.",
    question: "What are you waiting to buy?",
    hashtags: ["Deals", "FestiveSale", "PriceDrop"],
  },
  other_generic: {
    key: "other_generic",
    title: "This week in your industry: five developments worth your attention",
    summary: "A short roundup of the stories your audience is talking about this week.",
    tags: ["roundup", "weekly"],
    source_name: "Curated feeds",
    source_url: "https://example.com/roundup",
    hook: "Five things that happened this week, in 60 seconds.",
    intro: "Here's a quick roundup of the week's most relevant developments, rewritten in your brand voice.",
    sections: [
      ["The big story", "The headline development of the week and why it matters to your readers."],
      ["Worth watching", "Two smaller stories that could become big ones."],
      ["Quick hits", "Funding, launches and people moves in one paragraph."],
    ],
    numbers: ["5 stories", "3 minute read"],
    takeaway: "Short, consistent roundups build habit faster than long, irregular essays.",
    question: "What did we miss this week?",
    hashtags: ["WeeklyRoundup", "Industry", "News"],
  },
};

/** Topics a live pipeline run draws from, per workspace slug or industry. */
export const TOPIC_POOLS: Record<string, string[]> = {
  marketpulse: ["bank_nifty_psu", "it_earnings", "sensex_85k", "rbi_repo"],
  collegecompass: ["josaa_rounds", "jee_cutoffs", "bits_vs_vit"],
  ten: ["board_succession", "chief_ai_officer"],
  hackfinder: ["hackathon_roundup"],
  news_media: ["bank_nifty_psu", "it_earnings", "rbi_repo", "sensex_85k"],
  education: ["josaa_rounds", "jee_cutoffs", "bits_vs_vit"],
  executive_media: ["chief_ai_officer", "board_succession"],
  events: ["hackathon_roundup"],
  blog: ["blog_generic"],
  ecommerce: ["ecommerce_generic"],
  other: ["other_generic"],
};

/* ------------------------------------------------------------------ */
/* Variant builders                                                    */
/* ------------------------------------------------------------------ */

const EMOJI: Record<string, string> = { news_media: "📈", education: "🎓", events: "🚀", executive_media: "🧭", ecommerce: "🛍️", blog: "✍️" };

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

function firstSentence(s: string): string {
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : s;
}

export function slugFor(t: TopicSpec): string {
  return t.title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^(.{1,70})-.*$/, (m, a: string) => (m.length > 70 ? a : m))
    .replace(/-$/, "");
}

export function contentUrl(t: TopicSpec, ctx: BrandContext, slug = slugFor(t)): string {
  return `https://${ctx.domain ?? "example.com"}${ctx.pathPrefix}/${slug}`;
}

function article(t: TopicSpec, ctx: BrandContext): string {
  const [a, b, c] = t.sections;
  return [
    t.intro,
    "## Key numbers",
    t.numbers.map((n) => `- ${n}`).join("\n"),
    `## ${a[0]}`,
    a[1],
    b ? `## ${b[0]}\n\n${b[1]}` : "",
    c ? `## ${c[0]}\n\n${c[1]}` : "",
    "## The bottom line",
    t.takeaway,
    `*${ctx.persona} · Source: [${t.source_name}](${t.source_url})*`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function blogPost(t: TopicSpec, ctx: BrandContext): string {
  return [
    `> **Quick answer:** ${t.takeaway}`,
    t.intro,
    ...t.sections.map(([h, p]) => `## ${h}\n\n${p}`),
    "## At a glance",
    t.numbers.map((n) => `- ${n}`).join("\n"),
    "## FAQ",
    `**${t.question.replace(/ Tell us.*$/, "")}**\n\n${firstSentence(t.takeaway)}`,
    `*Written by ${ctx.persona} for ${ctx.brand}.*`,
  ].join("\n\n");
}

function linkedin(t: TopicSpec, ctx: BrandContext, maxTags: number): string {
  const tags = t.hashtags.slice(0, Math.max(0, maxTags)).map((h) => `#${h}`).join(" ");
  const parts = [t.hook, t.intro, t.numbers.map((n) => `→ ${n}`).join("\n"), t.takeaway, t.question, tags].filter(Boolean);
  let body = parts.join("\n\n");
  for (let i = 0; body.length < 900 && i < t.sections.length; i++) {
    parts.splice(2 + i, 0, t.sections[i][1]);
    body = parts.join("\n\n");
  }
  if (body.length > 1300) {
    const over = body.length - 1290;
    parts[1] = clip(parts[1], Math.max(120, parts[1].length - over));
    body = parts.join("\n\n");
  }
  void ctx;
  return body;
}

function xThread(t: TopicSpec, ctx: BrandContext, maxTags: number, slug: string): string {
  const tags = t.hashtags.slice(0, Math.min(2, maxTags)).map((h) => `#${h}`).join(" ");
  const raw = [t.hook, ...t.numbers, firstSentence(t.sections[0]?.[1] ?? t.intro), t.takeaway, `Full story: ${contentUrl(t, ctx, slug)}${tags ? ` ${tags}` : ""}`];
  const n = raw.length;
  return raw.map((s, i) => clip(`${i + 1}/${n} ${s}`, 278)).join("\n\n");
}

function instagram(t: TopicSpec, ctx: BrandContext): string {
  const e = EMOJI[ctx.industry] ?? "✨";
  const extra = ["India", ctx.brand.replace(/\W+/g, ""), "Explained", "DailyUpdate", "KnowMore"];
  const tags = [...t.hashtags, ...extra].map((h) => `#${h}`).join(" ");
  return [`${e} ${t.hook}`, t.summary, `🔑 Key numbers:\n${t.numbers.map((n) => `• ${n}`).join("\n")}`, `💡 ${t.takeaway}`, `💬 ${t.question}`, "🔗 Full story: link in bio", ".\n.\n.", tags].join("\n\n");
}

function newsletter(t: TopicSpec, ctx: BrandContext): string {
  return [
    `**${ctx.brand} Brief**`,
    "Good morning,",
    t.intro,
    "### Why it matters",
    t.sections[0]?.[1] ?? t.summary,
    "### By the numbers",
    t.numbers.map((n) => `- ${n}`).join("\n"),
    "### What to watch",
    t.sections[2]?.[1] ?? t.takeaway,
    `**Our take:** ${t.takeaway}`,
    `Until tomorrow,\n${ctx.persona}`,
  ].join("\n\n");
}

function videoScript(t: TopicSpec, ctx: BrandContext): string {
  const scenes = t.numbers.slice(0, 3).map((n, i) => `[SCENE ${i + 1}] (${4 + i * 9}–${12 + i * 9}s)\nOn screen: "${n}"\nVO: ${firstSentence(t.sections[i]?.[1] ?? t.intro)}`);
  return [
    `[HOOK] (0–3s)\nOn screen: bold text over b-roll\nVO: ${t.hook}`,
    ...scenes,
    `[TAKEAWAY] (31–38s)\nVO: ${t.takeaway}`,
    `[CTA] (38–42s)\nOn screen: ${ctx.brand} logo\nVO: ${t.question} Follow ${ctx.brand} for more.`,
  ].join("\n\n");
}

function facebook(t: TopicSpec, ctx: BrandContext, slug: string): string {
  return [t.hook, t.summary, t.takeaway, `Read more: ${contentUrl(t, ctx, slug)}`].join("\n\n");
}

function whatsapp(t: TopicSpec, ctx: BrandContext, slug: string): string {
  return [`*${t.title}*`, t.summary, t.numbers.slice(0, 3).map((n) => `▪️ ${n}`).join("\n"), `Read: ${contentUrl(t, ctx, slug)}`].join("\n\n");
}

export function buildVariant(t: TopicSpec, format: ContentFormat, ctx: BrandContext, opts: { maxTags?: number; slug?: string } = {}): ContentVariant {
  const maxTags = opts.maxTags ?? 3;
  const slug = opts.slug ?? slugFor(t);
  let body: string;
  switch (format) {
    case "article":
      body = article(t, ctx);
      break;
    case "blog_post":
      body = blogPost(t, ctx);
      break;
    case "linkedin_post":
      body = linkedin(t, ctx, maxTags);
      break;
    case "x_thread":
      body = xThread(t, ctx, maxTags, slug);
      break;
    case "instagram_caption":
      body = instagram(t, ctx);
      break;
    case "newsletter":
      body = newsletter(t, ctx);
      break;
    case "short_video_script":
      body = videoScript(t, ctx);
      break;
    case "facebook_post":
      body = facebook(t, ctx, slug);
      break;
    case "whatsapp_message":
      body = whatsapp(t, ctx, slug);
      break;
  }
  const titled = format === "article" || format === "blog_post" || format === "newsletter";
  return { format, title: titled ? t.title : null, body, char_count: body.length };
}

export function buildSeo(t: TopicSpec, ctx: BrandContext, schemaType: string, publishedAt: string, slug: string): NonNullable<ContentItem["seo"]> {
  const head = t.title.split(/[,:;]/)[0];
  const room = 60 - ctx.brand.length - 3;
  const titleTag = room >= 30 ? `${clip(head, room)} | ${ctx.brand}` : clip(head, 60);
  return {
    title_tag: titleTag,
    meta_description: clip(t.summary, 155),
    keywords: [...new Set([...t.tags.map((x) => x.replace(/-/g, " ")), ...t.hashtags.slice(0, 2).map((h) => h.toLowerCase())])],
    json_ld: {
      "@context": "https://schema.org",
      "@type": schemaType,
      headline: clip(t.title, 110),
      description: clip(t.summary, 155),
      datePublished: publishedAt,
      author: { "@type": "Person", name: ctx.persona.split(",")[0] },
      publisher: { "@type": "Organization", name: ctx.brand },
      mainEntityOfPage: contentUrl(t, ctx, slug),
    },
  };
}
