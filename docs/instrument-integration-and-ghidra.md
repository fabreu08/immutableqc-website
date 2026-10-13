<!-- Internal research memo (not published: the deploy allowlist never takes .md). Produced 2026-10-13 by a research
workflow (Ghidra and AI-assisted reverse engineering; instrument-data landscape and law) and corrected by a skeptic pass.
Sources marked (unverified) come from search summaries, not primary texts; nothing here is legal advice. -->

# Decision memo: can Ghidra be how Immutable QC plugs into any instrument software?

Internal, for the founder, 2026-10-13, revised after review. [n] is source n; [1:10] is line 10 of source 1. "(judgment)" marks my own estimate. "(unverified)" marks figures from search summaries or abstracts, not from the primary text.

## Decision

**Not Ghidra. The goal is right, though, and part of it deserves a test.** Ghidra is a workbench for reading compiled programs. It produces annotated programs and decompiled C, not connectors, plug-ins or parsers [3][5].

The plug that reaches every instrument is the v1 agent. It is designed to seal every file the instrument software writes, "with no reverse engineering and no vendor cooperation" [1:8-11]. Today it is a build spec, with no installer or service yet [1:3][1:22].

The founder's idea has real force one step later: getting values out of formats nothing else reads. For that, the cheapest and most defensible route is an AI agent working on the lab's own files, checked against the vendor's own exports. Decompiling vendor programs (Ghidra for native code, ILSpy for .NET) comes last, only under the conditions in step 6.

## The options side by side

| Option | Covers | First lab (judgment) | Cost and skill | Vendor updates | Legal and reputation | Lab IT/QA would say (judgment) |
|---|---|---|---|---|---|---|
| **A. Decompile, manual** | Native reader code, one format at a time; Ghidra cannot decompile .NET [6] | Months per format | Free tool [4]; expert skill | Each version is new work [22] | US: contract risk, and courts enforce such clauses [44][33]. EU: Art. 6 cannot be contracted away, but its conditions are narrow [34][45] | "You decompiled our vendor's software?" |
| **B. Decompile, AI-assisted** | Same as A; for .NET, ILSpy MCP servers exist [46] | Weeks to months, plus checking | Free servers; model fees unmeasured; expert still needed | Same as A | Same as A | "Who checked the AI's work?" |
| **B2. AI format inference on the lab's own files** | Values from formats nothing reads, with the vendor's exports as ground truth | Days to weeks per format (untested) | Model fees plus expert review | Test corpus shows when a version breaks it | Lowest of the reverse-engineering options [35][34]; still needs a licence check | "Show us it matches the vendor's export on our files." |
| **C. File-sealing agent (v1)** | Every file in the watched folders, any format, encrypted files as opaque bytes [1:10-11] | When it runs as a service | Being built; needs Node.js on the instrument PC [1:150][1:223][50] | Unaffected by format changes | No reverse engineering. Change control, service terms [31], one patent to clear [43] | "Prove it cannot disturb acquisition." [18][51] |
| **D. Standards, open readers, SDKs** | Values from exports and supported formats [20][21] | Weeks per instrument family | Mostly free; SDKs paid or restricted [29][23] | Parsers track versions [22] | Low to medium: licence terms [23][24] | "Is the original record still kept?" |
| **F. Capture where results already flow** | Pipelines, orchestrators [1:154], serial outputs [47] | Days for a pipeline hook | Small | Stable | Low | "That fits our workflow." |
| **E. Combination** | Bytes everywhere; values where a lab asks | When v1 ships | Lowest up front | C stable; B2 and D per format | Low unless A or B is used | "Clear scope; we can validate that." |

## Behind the table

**A. Decompile, manual.**
- Ghidra has no CIL processor. Its 39 processor directories include JVM and Dalvik, but nothing for .NET, so it cannot decompile .NET instrument software; ILSpy or dnSpyEx do that [6].
- For unknown data files, ImHex, 010 Editor ($149.95 commercial) or Kaitai Struct, which generates parsers, fit better [7]. Ghidra helps only when the bytes alone cannot explain compression, checksums or scaling constants (judgment).

The legal picture:
- **Licence terms.** Agilent's terms bar reverse compiling "unless authorized or permitted by law" [30]. Thermo's licence for its reader library bans decompiling and even "reflection" [23:§2.1]. That licence covers the library, not instrument software.
- **US.** Contracts decide.
  - Bowers v. Baystate enforced a shrink-wrap ban on reverse engineering [44].
  - In Davidson v. Jung, the court enforced EULA and TOU limits on reverse engineering, found that enforcing them did not conflict with §1201(f), and rejected the §1201(f) defence on its own elements [33] (unverified).
  - §1201 only matters if a technical protection is circumvented. The Copyright Office's better reading is that §1201(f) can cover end users [32].
  - Without circumvention, the questions are contract and fair use [48].
- **EU.**
  - Art. 6 allows decompilation by or for the licensee, when "indispensable", for information "not previously readily available", and the results may not be passed on except for interoperability [34].
  - Art. 8 voids contract terms that conflict with Art. 6 or Art. 5(3) [45].
  - An existing export or SDK usually defeats "not previously readily available" (judgment).

None of the open-source readers I checked says it was built by decompiling vendor programs [20][22][40]. A trust product that bans vendor names in its own copy [38] should not become known for decompiling vendor software (judgment).

**B. Decompile, AI-assisted.**
- **Tools.** The Ghidra MCP servers are all third-party, none from the NSA. One calls itself "beta". None emits a format specification or parser [8]. ILSpy-based MCP servers exist [46], and decompiled C# is closer to source than decompiled C (judgment).
- **Evidence.** I found no study of LLMs recovering proprietary data-file formats.
  - A 2025 survey says work on raw bytes is underexplored [9].
  - SRE-Bench (August 2026): the best model fully solved 31.5% of instances (80 of 254), with 61.4% mean rubric credit [9] (unverified).
  - The SRE-Bench project page says the benchmark is "in progress", and a September 2026 leaderboard reports higher scores under different scoring [9] (unverified).
  - The field is moving; re-check in six months (judgment).
- **Field reports.** They describe hallucinated annotations that needed human correction [10], and a misidentified target that a human had to patch around [11] (unverified).
- **Prompt injection.** Strings planted in a binary made a GhidraMCP agent misread it; the test used an 8B local model [12]. Instrument software is not built to attack analysts, so this is a minor risk here (judgment).

AI speeds up triage. It removes no contract limit and no need for expert review.

**B2. AI format inference on the lab's own files.** This is the strongest form of the founder's idea.
- **Method.** The lab saves raw files plus the vendor's exports of the same runs. An agent using ImHex or Kaitai:
  - checks for standard containers first (Agilent `.dx` is a zip, Shimadzu `.lcd` is an OLE document [40]);
  - searches the raw bytes for the exported numbers;
  - drafts a Kaitai spec plus a test that must reproduce the exports on files it has not seen.
- **No decompiling.** No vendor program is decompiled. File formats are not protected as program expression, though they may be protected as works under the InfoSoc Directive [35]. EU licensees may observe, study and test a running program, and contracts cannot remove that right [34][45].
- **Prior work.** The one public attempt I found has a single commit and reports no results [49]. The idea is untested, so test it.

**C. The v1 agent.**
- **Reaches:** results wherever software writes files, such as MS workstations, standard plate-reader editions, PC spectroscopy, NMR and microscopy images [17][15][39].
- **Does not reach:** results kept only in an enterprise CDS database [14], GxP plate-reader editions [15], or instruments that write no file [16].

Where folder watching fails or misleads:
1. **An edited file passes.** An edit is sealed as a new version. The audit checks only the latest version, so the result is a pass with a note, unless `--strict` is set [1:92-94][1:122-124][1:135-138].
2. **The ledger and key live with the data.** The ledger defaults to the data folder [1:47-49] and the key to the user profile [1:164-165]. Someone who can delete data, or who holds the key, can start the ledger over or rewrite it. Only a key id or head pinned elsewhere shows that [1:28-29][1:132-133], and pinning is manual today [1:157].
3. **Coverage stops when the agent stops.** There is no service [1:22], and `watch` runs until Ctrl+C [1:153]. Changes made while it is stopped appear only as notes [1:93-94].
4. **The window before sealing is not always seconds.**
   - A file is sealed once it has been unchanged for 3 seconds and is readable [1:173-175]. Files written in bursts get partial seals; locked files wait until the run ends.
   - The Windows SMB client caches file information for 10 seconds by default [52], longer than the 3-second settle time.
5. **It can disturb acquisition.**
   - Node opens files with full sharing [53]. But a vendor program that opens a file exclusively while the agent holds it fails with ERROR_SHARING_VIOLATION [54].
   - Two vendors warn about real-time scanners and backup software for exactly this reason [18][51].
   - Polling alone does not prevent this (judgment).
6. **Files the vendor software moves away** count as missing and fail the audit [19][1:125][1:135].
7. **It writes an `ImmutableQC` folder into the vendor's data folder** [1:47-49].
8. **Scale.** A full audit re-reads every byte [1:194-196]. Multi-terabyte imaging folders take hours (judgment).
9. **Runtime.**
   - The agent needs Node.js 20 or later [1:150], and Node 20 reached end of life on 2026-04-30 [50].
   - Current Node releases fully support only Windows 10 / Server 2016 or later [55].
   - QA will want a validation pack. One vendor says instruments with electronic records fall under USP <1058> Group C [16], and changing a connected computer can void one vendor's service coverage [31].
10. **Patent.** Clear freedom to operate for US11502847 [43].

Other software already watches folders [56]. Some vendor platforms offer raw-data verification [41][57]. What IQC adds is a check anyone can recompute with published code, without the vendor's software [1:35].

**D. Standards and open readers.**
- allotropy (MIT) turns text and Excel exports from about 45 software packages into ASM, with "no need to interact with any of the specific vendor softwares" [20].
- rainbow (LGPL-3.0) reads Agilent and Waters raw formats and exports ASM [17][21].
- Major CDS products export ANDI/AIA, though one leaves out processing and methods [28].
- Licences matter:
  - Thermo's reader bars commercial exploitation of products that incorporate it without written consent, and bars distributing it with GPL code as a combined work [23].
  - ASM is CC-BY-ND for commercial use [24].
- Adoption is thin:
  - A manufacturer survey reports "growing" SiLA 2 support [25].
  - The first LADS products I found are vacuum pumps shown at analytica 2026; I found no analytical instrument with it [26].
  - I could not confirm that AnIML was ever published as a standard [27].

An extracted value is derived, not the original record. Seal the raw file, the reported value and the software version together [2, section d].

**F. Capture where results already flow.**
- `iqc seal` is already meant for a scheduler or pipeline [1:154].
- Automated research labs are the first audience [38:62], and sealing at capture is the planned main integration [38:68].
- Balances and similar instruments often have documented serial command sets [47].
- Hooking the vendor program at run time [58] is rejected: it changes the vendor's software while it runs (judgment).

**E. Combination.**
- C is the universal plug for bytes; F covers automated pipelines; D comes in when a lab asks for values; B2 is for formats nothing reads.
- A lab that already licenses a vendor SDK can use it [29].
- An EU Data Act request is a lawful way to get machine-readable data, a direction to watch, not legal advice:
  - Access by design applies to products placed on the market from 2026-09-12 [36].
  - It covers raw and pre-processed data, generally not derived results [59] (unverified).
- A and B come last.

## Recommendation and sequence

1. **Now: ship v1, with these changes:**
   - write-once rules, so that a second version of a raw-data file fails the audit;
   - the ledger outside vendor-managed folders on instrument PCs, with the key id and head recorded elsewhere at install;
   - a Windows service, pulled forward;
   - acquisition-safe reading: a longer settle time on network shares (more than 10 seconds), never reading a file the acquisition program still has open, and low-priority I/O;
   - expected-move and ignore rules;
   - re-saved files shown as a version history;
   - a validation pack (IQ/OQ, risk assessment);
   - a patent check.

   Fixing the alpha's defects still matters more than anything Ghidra could offer [2, section a].
2. **Automated labs:** seal from the pipeline or orchestrator with `iqc seal` [1:154].
3. **Labs whose results live in a database:** seal scheduled exports, and say plainly what stays in the vendor's database [14][28].
4. **First paying request for values:** use allotropy or rainbow, and seal the raw file and the extracted value together [20][21].
5. **Test B2, time-boxed to 2–5 days (judgment):**
   - Pick a format that an open reader already decodes, and hide that reader from the agent.
   - Have the agent recover the format from sample files plus the vendor's exports.
   - Score it on two things: does it reproduce the exports on files it has not seen, and how many expert hours did it take?
   - The legal risk is nil, because the format is already public.
6. **Decompile only if all of these hold:**
   - A paying lab needs values from one format.
   - No export, standard, open reader, SDK, Data Act request or B2 result provides them.
   - The answer sits in reader code (Ghidra for native code, ILSpy for .NET).
   - A lawyer has reviewed that vendor's licence for that jurisdiction:
     - In the EU, the lab, as licensee, commissions the work under Art. 6 [34][45].
     - In the US, get written vendor permission, because contracts are enforced [44].
   - No encryption is broken, and the work runs on a patched, sandboxed machine [13].
   - The deliverable is a human-reviewed Kaitai spec, checked against the vendor's own exports and kept off the public site.
7. **Later:** a SiLA 2 adapter, then LADS [2, section b].

Ghidra would not move the security boundary either. Tampering before a file is sealed is out of scope in the threat model [42].

## What to tell a lab

"Immutable QC works with the software you already have. It does not modify your instrument software or your result files. A small agent reads each file once the file stops changing, and records its SHA-256 fingerprint in a signed ledger kept in a folder you choose. Every later change is sealed as a new version and listed. Raw-data files can be set so that any change fails the audit. Anyone can re-check the whole folder in a browser, using published code, with nothing uploaded. A pass shows that every file matches its latest seal and that the ledger has not been edited. It does not show that values were right when written. It does not cover changes made before a file is sealed, or while the agent was stopped (those are flagged). It cannot catch someone who holds the key or deletes the ledger, unless the ledger's head has been recorded somewhere else. Where your results live only in a vendor database, we seal the exports you schedule and tell you exactly what is and is not covered." [1:8-15][1:24-29][1:35][1:93-94][1:188-189]

## Sources

Sources 1–42 (original memo):

1. /home/user/immutableqc-website/docs/product-v1.md
2. /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/ghidra/iqc-needs.md
3. https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Features/Decompiler/src/main/java/ghidra/app/util/exporter/CppExporter.java
4. https://github.com/NationalSecurityAgency/ghidra/blob/master/LICENSE
5. https://github.com/NationalSecurityAgency/ghidra/blob/master/GhidraDocs/GettingStarted.md
6. https://github.com/NationalSecurityAgency/ghidra/tree/master/Ghidra/Processors ; https://github.com/NationalSecurityAgency/ghidra/issues/4159
7. https://github.com/WerWolv/ImHex ; https://www.sweetscape.com/store/resellers ; https://github.com/kaitai-io/kaitai_struct ; https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Processors/DATA/data/languages/data.ldefs
8. https://github.com/LaurieWired/GhidraMCP ; https://github.com/clearbluejar/pyghidra-mcp ; https://github.com/cyberkaida/reverse-engineering-assistant ; https://github.com/jtang613/GhidrAssistMCP ; https://github.com/themixednuts/GhidraMCP
9. https://arxiv.org/pdf/2608.11469 ; https://arxiv.org/pdf/2509.21821
10. https://digitalcommons.kennesaw.edu/ccerp/2025/research/6
11. https://quesma.com/blog/ghidra-mcp-unlimited-lives/
12. https://arxiv.org/pdf/2605.30667
13. https://github.com/NationalSecurityAgency/ghidra/blob/master/README.md
14. https://docs.thermofisher.com/r/Chromeleon-7.3.2-MUa-Installation-Guide/1119523851v9en-US1129314699 ; https://www.waters.com/webassets/cms/library/docs/720000441en.pdf
15. https://moleculardevices.com/sites/default/files/en/assets/flyer/br/softmax-pro-file-conversion-and-import-function-of-legacy-gxp-software-files.pdf ; https://assets.fishersci.com/TFS-Assets/CCG/EU/Biotek-Instruments/manuals/BTK008_FR%20Gen%205.pdf
16. https://www.mt.com/au/en/home/library/usercoms/lab-analytical-instruments/21_cfr_part_11.html
17. https://github.com/evanyeyeye/rainbow ; https://github.com/jjhelmus/nmrglue/blob/master/nmrglue/fileio/bruker.py ; https://github.com/qedsoftware/brukeropusreader
18. https://support.waters.com/KB_Inf/MassLynx/WKB1462_Error_Data_Buffer_Overflow_messages_in_the_console
19. https://www.tecan.com/knowledge-portal/which-information-and-files-are-required-for-a-first-assessment-of-an-issue-with-fluentcontrol ; https://openlab.help.agilent.com/2.8/en/mergedProjects/DataAnalysis/iDA_ExportOpenLABData.htm
20. https://github.com/Benchling-Open-Source/allotropy
21. https://pypi.org/pypi/rainbow-api/json
22. https://github.com/ethanbass/chromConverter
23. https://github.com/thermofisherlsms/RawFileReader (License.doc §2.1, §4.2, §4.3)
24. https://gitlab.com/allotrope-public/asm (LICENSE.md)
25. https://irf.fhnw.ch/entities/publication/c5c0a922-8b1a-48b4-8e3c-ff95150ba342 ; https://gitlab.com/unitelabs/connectors/tecan-fluentcontrol
26. https://www.vacuubrand.com/news/all-blog-posts/lads-opc-ua
27. https://www.astm.org/news/press-releases/astm-molecular-spectroscopy-and-separation-science-committee-continues-work-proposed-analytical
28. https://support.waters.com/KB_Inf/Empower_Breeze/WKB26380_Can_data_be_exported_as_CDF_files_from_Empower_3 ; https://openlab.help.agilent.com/en/mergedProjects/DataAnalysis/45036003199708043.htm
29. https://assets.thermofisher.com/TFS-Assets/CMD/Specification-Sheets/ps-74111-chromeleon-sdk-specifications-ps74111-en.pdf ; https://support.waters.com/KB_Inf/Empower_Breeze/WKB5584_How_can_I_tell_if_Toolkit_is_installed_in_Empower_environment
30. https://www.agilent.com/cs/library/support/Sales-Services-Terms/Terms_of_Sale_IDO_EMEA_English.pdf
31. https://asset-downloads.zeiss.com/catalogs/download/mic/13202fa5-8aae-4248-b517-3133930984b3/Software_Maintenance_Agreements_-_General_Conditions.pdf
32. https://uscode.house.gov/quicksearch/get.plx?title=17&section=1201 ; https://www.copyright.gov/policy/1201/section-1201-full-report.pdf ; https://www.copyright.gov/1201/2027/
33. https://studicata.com/case-briefs/case/davidson-associates-v-jung
34. https://www.legislation.gov.uk/eudr/2009/24/article/6
35. https://www.pinsentmasons.com/out-law/news/computer-program-functionality-not-copyrightable-but-programming-languages-and-file-formats-may-be-protected-by-the-copyright-directive-ecj-rules
36. https://www.eversheds-sutherland.com/en/estonia/insights/when-do-the-design-obligations-under-the-data-act-apply-understanding-article-3-and-article-50 ; https://www.springlex.eu/en/packages/data-act/data-act-regulation/article-4/
37. https://gcms.labrulez.com/paper/5477
38. /home/user/immutableqc-website/docs/RESUME.md:68
39. https://www.moleculardevices.com/sites/default/files/en/assets/user-guide/dd/img/high-content-screening-it-requirements.pdf
40. /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/ghidra/landscape/rb_docs_source_formats.rst ; /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/ghidra/landscape/chromconv-readme.md
41. https://assets.thermofisher.com/TFS-Assets/CMD/Reference-Materials/wp-72664-cds-audit-trails-wp72664-en.pdf
42. /home/user/immutableqc-website/docs/architecture-and-threat-model.md:32

The memo body is about 1,290 words, not counting citations, table markup or the source list. Nothing was written in any repository. The scratch folder holds no clones (1.3 MB in total), and the working draft was deleted.

Changes and additions to 1–42 after review:
- [9] adds https://huggingface.co/papers/2608.11469 , https://promptfoo.dev/lm-security-db/vuln/agentic-binary-reverse-engineering-capability-gaps-67e68f7d/ , https://daplab.cs.columbia.edu/benchmarks/sre-bench/ , https://benchlm.ai/benchmarks/srebench
- [12] adds https://papers.academic-conferences.org/index.php/eccws/article/view/4597
- [26] adds https://labokraft.hu/blog/blog-2/post/lads-opc-ua-integrate-vacuum-pumps-into-your-digital-laboratory-68
- [32] adds https://project-disco.org/intellectual-property/070617-interoperability-and-the-copyright-offices-section-1201-report/
- [33] becomes https://www.casemine.com/judgement/us/59147400add7b04934399488 ; https://case-law.vlex.com/vid/davidson-associates-v-jung-890595100
- [35] adds https://legalblogs.wolterskluwer.com/copyright-blog/decrypting-the-code-cjeu-sas-vs-world-programming/
- [38] is /home/user/immutableqc-website/docs/RESUME.md (lines 62, 68)
- [40] adds /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/ghidra/landscape/rb_docs_source_agilent_dx.rst:8 and .../landscape/cc/read_shimadzu_lcd.R:7-24

New sources:

43. https://patents.google.com/patent/US11502847
44. https://law.resource.org/pub/us/case/reporter/F3/320/320.F3d.1317.01-1109.01-1108.html
45. https://www.legislation.gov.uk/eudr/2009/24/article/8 ; https://www.ippt.eu/legal-texts/software-directive/article-8 ; https://eur-lex.europa.eu/eli/dir/2009/24/oj (Art. 5(3))
46. https://www.nuget.org/packages/ILSpyMcpServer
47. https://www.mt.com/ca/en/home/library/user-manuals/laboratory-weighing/rm-mt-sics-ma.html
48. https://www.copyright.gov/fair-use/summaries/sony-connectix-9thcir2000.pdf
49. https://github.com/MzaxnaV/ksy-agent
50. https://github.com/nodejs/Release/blob/main/schedule.json
51. https://sciex.com/support/knowledge-base-articles/general-guidance-for-antivirus-and-backup-software_en_us
52. https://learn.microsoft.com/en-us/windows-server/administration/performance-tuning/role/file-server
53. https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c
54. https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
55. https://github.com/nodejs/node/blob/v22.x/BUILDING.md
56. https://casrai.org/dictionary/term/scientific-data-management-system-sdms ; https://developers.tetrascience.com/docs/upload-instrument-data-using-a-tetra-file-log-agent
57. https://docs.thermofisher.com/r/Ardia-Core-Software-1.1-User-Guide/2232509195v3en-US2232209419
58. https://github.com/frida/frida
59. https://www.hoganlovells.com/en/publications/decoding-the-eu-data-act-data-types-covered-by-data-access-and-sharing-rights
