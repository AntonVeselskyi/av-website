" ============================================================================
" sandstorm.vim — a warm desert.vim descendant
"
" Ported back to Vim from the Visual Studio 2022 scheme of the same name.
" desert.vim is the ancestor; this is what it looks like after twenty years
" of better screens: sand canvas, storm-blue keywords, gold gutter.
"
" Anton Veselskyi · https://antonveselskyi.com
"
" Install:  copy to ~/.vim/colors/  (or ~/.config/nvim/colors/)
"           then  :colorscheme sandstorm
" Requires a truecolor terminal:  set termguicolors
" ============================================================================

hi clear
if exists("syntax_on")
  syntax reset
endif

set background=dark
let g:colors_name = "sandstorm"

" ── Palette ─────────────────────────────────────────────────────────────────
"   bg      #1e1e1e   canvas
"   fg      #d8d0c0   plain text (warm sand)
"   sand    #e8a038   enum / constant
"   gold    #907040   line numbers
"   storm   #58a8e8   keywords
"   aqua    #38dcc0   types
"   coral   #ff7060   classes / structs / namespaces
"   spring  #00ff7f   functions / methods
"   yellow  #f8dc68   variables
"   lav     #b8a0d8   comments
"   terra   #e07848   strings
"   green   #88d878   numbers
"   violet  #d050f0   macros
"   orange  #ff5800   template params / special
"   muted   #989080   preprocessor
"   cursorl #4a4038   current line
"   select  #c9a96e   selection

" ── Editor chrome ───────────────────────────────────────────────────────────
hi Normal        guifg=#d8d0c0 guibg=#1e1e1e ctermfg=252 ctermbg=234 gui=NONE cterm=NONE
hi NonText       guifg=#3a3a3a guibg=NONE    ctermfg=237
hi EndOfBuffer   guifg=#2a2a2a guibg=NONE    ctermfg=236
hi LineNr        guifg=#907040 guibg=NONE    ctermfg=94
hi CursorLineNr  guifg=#f8dc68 guibg=#4a4038 ctermfg=222 ctermbg=237 gui=NONE cterm=NONE
hi CursorLine    guibg=#4a4038 ctermbg=237   gui=NONE cterm=NONE
hi CursorColumn  guibg=#4a4038 ctermbg=237
hi ColorColumn   guibg=#2a2422 ctermbg=235
hi Visual        guifg=#000000 guibg=#c9a96e ctermfg=16 ctermbg=180
hi VisualNOS     guibg=#4a4038 ctermbg=237
hi Cursor        guifg=#1e1e1e guibg=#f8dc68 ctermfg=234 ctermbg=222
hi MatchParen    guifg=#00ff7f guibg=#38322a ctermfg=48 ctermbg=236 gui=bold cterm=bold
hi SignColumn    guibg=#1e1e1e ctermbg=234
hi Folded        guifg=#8a8175 guibg=#232323 ctermfg=245 ctermbg=235
hi FoldColumn    guifg=#6a6258 guibg=#1e1e1e ctermfg=242 ctermbg=234
hi VertSplit     guifg=#2e2e2e guibg=NONE    ctermfg=236 gui=NONE cterm=NONE
hi WinSeparator  guifg=#2e2e2e guibg=NONE    ctermfg=236

hi StatusLine    guifg=#d8d0c0 guibg=#2e2822 ctermfg=252 ctermbg=236 gui=NONE cterm=NONE
hi StatusLineNC  guifg=#6a6258 guibg=#242220 ctermfg=242 ctermbg=235 gui=NONE cterm=NONE
hi TabLine       guifg=#6e675d guibg=#181818 ctermfg=242 ctermbg=234 gui=NONE cterm=NONE
hi TabLineSel    guifg=#e8d8b8 guibg=#1e1e1e ctermfg=223 ctermbg=234 gui=NONE cterm=NONE
hi TabLineFill   guibg=#181818 ctermbg=234

hi Pmenu         guifg=#d8d0c0 guibg=#252220 ctermfg=252 ctermbg=235
hi PmenuSel      guifg=#f0e6d2 guibg=#3a3228 ctermfg=230 ctermbg=237
hi PmenuSbar     guibg=#252220 ctermbg=235
hi PmenuThumb    guibg=#4a4038 ctermbg=237

hi Search        guifg=#1e1e1e guibg=#e8a038 ctermfg=234 ctermbg=214
hi IncSearch     guifg=#1e1e1e guibg=#f8dc68 ctermfg=234 ctermbg=222
hi CurSearch     guifg=#1e1e1e guibg=#f8dc68 ctermfg=234 ctermbg=222

hi Directory     guifg=#38dcc0 ctermfg=79
hi Title         guifg=#e8a038 ctermfg=214 gui=bold cterm=bold
hi Question      guifg=#88d878 ctermfg=114
hi MoreMsg       guifg=#88d878 ctermfg=114
hi ModeMsg       guifg=#f8dc68 ctermfg=222
hi WarningMsg    guifg=#e8a038 ctermfg=214
hi ErrorMsg      guifg=#ff5800 guibg=NONE ctermfg=202
hi SpecialKey    guifg=#3a3a3a ctermfg=237
hi Whitespace    guifg=#3a3a3a ctermfg=237
hi Conceal       guifg=#6a6258 ctermfg=242

" ── Syntax ──────────────────────────────────────────────────────────────────
hi Comment       guifg=#b8a0d8 ctermfg=182 gui=NONE cterm=NONE

hi Constant      guifg=#e8a038 ctermfg=214
hi String        guifg=#e07848 ctermfg=173
hi Character     guifg=#e07848 ctermfg=173
hi Number        guifg=#88d878 ctermfg=114
hi Float         guifg=#88d878 ctermfg=114
hi Boolean       guifg=#58a8e8 ctermfg=75

hi Identifier    guifg=#f8dc68 ctermfg=222 gui=NONE cterm=NONE
hi Function      guifg=#00ff7f ctermfg=48

hi Statement     guifg=#58a8e8 ctermfg=75  gui=NONE cterm=NONE
hi Conditional   guifg=#58a8e8 ctermfg=75
hi Repeat        guifg=#58a8e8 ctermfg=75
hi Label         guifg=#58a8e8 ctermfg=75
hi Operator      guifg=#d8d0c0 ctermfg=252
hi Keyword       guifg=#58a8e8 ctermfg=75
hi Exception     guifg=#58a8e8 ctermfg=75

hi PreProc       guifg=#989080 ctermfg=246
hi Include       guifg=#989080 ctermfg=246
hi Define        guifg=#989080 ctermfg=246
hi Macro         guifg=#d050f0 ctermfg=171
hi PreCondit     guifg=#989080 ctermfg=246

hi Type          guifg=#38dcc0 ctermfg=79  gui=NONE cterm=NONE
hi StorageClass  guifg=#58a8e8 ctermfg=75
hi Structure     guifg=#ff7060 ctermfg=203
hi Typedef       guifg=#38dcc0 ctermfg=79

hi Special       guifg=#ff5800 ctermfg=202
hi SpecialChar   guifg=#e8a038 ctermfg=214
hi Tag           guifg=#ff7060 ctermfg=203
hi Delimiter     guifg=#d8d0c0 ctermfg=252
hi SpecialComment guifg=#c9b0e0 ctermfg=183
hi Debug         guifg=#ff5800 ctermfg=202

hi Underlined    guifg=#58a8e8 ctermfg=75 gui=underline cterm=underline
hi Ignore        guifg=#3a3a3a ctermfg=237
hi Error         guifg=#ff5800 guibg=NONE ctermfg=202 gui=NONE cterm=NONE
hi Todo          guifg=#1e1e1e guibg=#e8a038 ctermfg=234 ctermbg=214 gui=bold cterm=bold

" ── Diff / VCS ──────────────────────────────────────────────────────────────
hi DiffAdd       guifg=#88d878 guibg=#1e2a1e ctermfg=114 ctermbg=235
hi DiffChange    guifg=#58a8e8 guibg=#1e2430 ctermfg=75  ctermbg=235
hi DiffDelete    guifg=#ff7060 guibg=#2a1e1e ctermfg=203 ctermbg=235
hi DiffText      guifg=#f8dc68 guibg=#3a3020 ctermfg=222 ctermbg=237 gui=NONE cterm=NONE

" ── Spelling ────────────────────────────────────────────────────────────────
hi SpellBad      guisp=#ff5800 gui=undercurl cterm=undercurl
hi SpellCap      guisp=#58a8e8 gui=undercurl cterm=undercurl
hi SpellRare     guisp=#d050f0 gui=undercurl cterm=undercurl
hi SpellLocal    guisp=#38dcc0 gui=undercurl cterm=undercurl

" ── C / C++ specifics (mirrors the Visual Studio build) ─────────────────────
hi link cType            Type
hi link cStorageClass    StorageClass
hi link cStructure       Structure
hi link cppStructure     Structure
hi link cCustomClass     Structure
hi link cppSTLnamespace  Structure
hi link cppSTLtype       Type
hi link cppSTLfunction   Function
hi link cUserLabel       Label
hi link cEnumeration     Constant

" ── Neovim: treesitter ──────────────────────────────────────────────────────
if has('nvim')
  hi link @comment            Comment
  hi link @string             String
  hi link @character          Character
  hi link @number             Number
  hi link @boolean            Boolean
  hi link @keyword            Keyword
  hi link @keyword.function   Keyword
  hi link @keyword.return     Keyword
  hi link @conditional        Conditional
  hi link @repeat             Repeat
  hi link @operator           Operator
  hi link @punctuation        Delimiter
  hi link @function           Function
  hi link @function.call      Function
  hi link @function.macro     Macro
  hi link @method             Function
  hi link @method.call        Function
  hi link @constructor        Structure
  hi link @variable           Identifier
  hi link @variable.builtin   Identifier
  hi link @parameter          Identifier
  hi link @field              Identifier
  hi link @property           Identifier
  hi link @type               Type
  hi link @type.builtin       Type
  hi link @type.definition    Typedef
  hi link @namespace          Structure
  hi link @constant           Constant
  hi link @constant.builtin   Constant
  hi link @constant.macro     Macro
  hi link @preproc            PreProc
  hi link @include            Include
  hi link @define             Define
  hi link @label              Label
  hi link @tag                Tag
  hi link @text.todo          Todo

  " newer capture names (nvim 0.10+)
  hi link @variable.parameter Identifier
  hi link @variable.member    Identifier
  hi link @module             Structure
  hi link @function.method    Function

  " LSP semantic tokens
  hi link @lsp.type.class     Structure
  hi link @lsp.type.struct    Structure
  hi link @lsp.type.namespace Structure
  hi link @lsp.type.enum      Constant
  hi link @lsp.type.enumMember Constant
  hi link @lsp.type.function  Function
  hi link @lsp.type.method    Function
  hi link @lsp.type.macro     Macro
  hi link @lsp.type.type      Type
  hi link @lsp.type.typeParameter Special
  hi link @lsp.type.variable  Identifier
  hi link @lsp.type.parameter Identifier
  hi link @lsp.type.property  Identifier

  hi DiagnosticError guifg=#ff5800 ctermfg=202
  hi DiagnosticWarn  guifg=#e8a038 ctermfg=214
  hi DiagnosticInfo  guifg=#58a8e8 ctermfg=75
  hi DiagnosticHint  guifg=#38dcc0 ctermfg=79
  hi NormalFloat     guifg=#d8d0c0 guibg=#1a1a1a ctermfg=252 ctermbg=234
  hi FloatBorder     guifg=#4a4038 guibg=#1a1a1a ctermfg=237 ctermbg=234
endif
