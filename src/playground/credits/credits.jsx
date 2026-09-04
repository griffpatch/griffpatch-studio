import React from 'react';
import PropTypes from 'prop-types';
import render from '../app-target';
import styles from './credits.css';

import {APP_NAME, APP_CHANNEL, APP_TAGLINE} from '../../lib/brand';
import studioMark from '../../../static/brand/griffpatch-studio.svg';
import {applyGuiColors} from '../../lib/themes/guiHelpers';
import {detectTheme} from '../../lib/themes/themePersistance';
import UserData from './users';

/* eslint-disable react/jsx-no-literals */

applyGuiColors(detectTheme());
document.documentElement.lang = 'en';

const User = ({image, text, href}) => (
    <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={styles.user}
    >
        <img
            loading="lazy"
            className={styles.userImage}
            src={image}
            width="60"
            height="60"
        />
        <div className={styles.userInfo}>
            {text}
        </div>
    </a>
);
User.propTypes = {
    image: PropTypes.string.isRequired,
    text: PropTypes.string.isRequired,
    href: PropTypes.string
};

const UserList = ({users}) => (
    <div className={styles.users}>
        {users.map((data, index) => (
            <User
                key={index}
                {...data}
            />
        ))}
    </div>
);
UserList.propTypes = {
    users: PropTypes.arrayOf(PropTypes.object)
};

const Credits = () => (
    <main className={styles.main}>
        <header className={styles.headerContainer}>
            <img
                className={styles.brandMark}
                src={studioMark}
                alt=""
            />
            <h1 className={styles.headerText}>
                {APP_NAME}
            </h1>
            <span className={styles.channel}>{APP_CHANNEL}</span>
            <p>{APP_TAGLINE}</p>
        </header>
        <section>
            <h2>My TurboWarp experiments</h2>
            <p>
                Griffpatch Studio is where I play around with ideas for expanding TurboWarp&apos;s
                development interface in interesting and new ways. It is a place to try things out,
                see what feels useful and keep exploring what working with blocks could be like.
            </p>
            <p>
                The block editor, compiler and many addons build on the work of the communities credited below.
                Griffpatch Studio is not an official Scratch or TurboWarp release.
            </p>
        </section>
        <section id="experiments">
            <h2>A few experiments so far</h2>
            <ul>
                <li>
                    <strong>Keyboard block editing.</strong> Type and complete blocks, edit their inputs,
                    transform compatible blocks and navigate scripts with the keyboard or mouse.
                </li>
                <li>
                    <strong>Find and jump.</strong> Search across sprites, jump to definitions and
                    return to where you were, with keyboard navigation integrated into the Finder.
                </li>
                <li>
                    <strong>A resizable code minimap.</strong> Get an overview of a sprite&apos;s scripts
                    and move around the workspace without losing your bearings.
                </li>
                <li>
                    <strong>Script breadcrumbs.</strong> Keep track of the current sprite and script,
                    with a way back to the top when the stack extends offscreen.
                </li>
            </ul>
            <p>
                These ideas are still evolving. This local preview is not a public release;
                keep a saved copy of any project you want to keep.
            </p>
        </section>
        <section id="feedback">
            <h2>Preview feedback</h2>
            <p>
                Please use the <a href="https://github.com/griffpatch/griffpatch-studio/issues/new/choose">Studio issue forms</a>,
                including the build identifier and the steps to reproduce a problem.
                Please do not include private projects or personal details in public reports.
                Please do not send Griffpatch Studio-specific problems to the TurboWarp or Scratch maintainers.
            </p>
            <p>
                For privacy, security or other private matters, contact{' '}
                <a href="mailto:studio@griffpatch.academy">studio@griffpatch.academy</a>.
                This is not a general Scratch coding-help service.
            </p>
        </section>
        <section id="source">
            <h2>Source & licences</h2>
            <p>
                This GUI fork retains its <a href="licenses/gui-GPL-3.0.txt">GNU GPL version 3 licence</a> and
                upstream notices. The public source repositories are{' '}
                <a href="https://github.com/griffpatch/griffpatch-studio">Griffpatch Studio</a> and{' '}
                <a href="https://github.com/griffpatch/griffpatch-studio-blocks">Griffpatch Studio Blocks</a>.
                The README explains the matching Blocks revision and build steps.
                {' '}See the <a href="licenses/griffpatch-studio-notice.txt">fork notice</a> for modification
                information and the licence/no-warranty summary.
            </p>
            <p>
                <a href="licenses/third-party-notices.txt">Third-party licences and notices</a> include
                dependency attributions, copied libraries, fonts and Unicode data.
            </p>
            <p>
                Upstream source: <a href="https://github.com/TurboWarp/scratch-gui">TurboWarp GUI</a>,{' '}
                <a href="https://github.com/scratchfoundation/scratch-blocks">Scratch Blocks</a> and{' '}
                <a href="https://github.com/ScratchAddons/ScratchAddons">Scratch Addons</a>.
                These repositories are credits, not downloads of this modified build.
                See also the retained <a href="licenses/upstream-trademark.txt">upstream trademark notice</a>.
            </p>
        </section>
        <section id="preview-privacy">
            <h2>Preview privacy information</h2>
            <p>
                This is a local development preview, not a completed privacy policy.
                Editor preferences and some session data are stored in this browser.
                Online features can still contact Scratch, TurboWarp and other services using inherited configurations.
                Local hosting does not mean every feature works offline or keeps all data on this device.
            </p>
            <p>
                The <a href="https://turbowarp.org/privacy.html">TurboWarp service privacy policy</a> describes
                TurboWarp, not Griffpatch Studio. Service endpoints, data flows, retention and the operator&apos;s
                privacy information must be reviewed before a public release.
                Avoid sensitive information in this preview.
                {' '}Read the <a href="privacy.html">current data and storage summary</a>.
            </p>
        </section>
        {APP_NAME !== 'TurboWarp' && (
            // Be kind and considerate. Don't remove this :)
            <section>
                <h2>TurboWarp</h2>
                <p>
                    {APP_NAME} is based on <a href="https://turbowarp.org/">TurboWarp</a>.
                </p>
            </section>
        )}
        <section>
            <h2>Scratch</h2>
            <p>
                {APP_NAME} is based on the work of the <a href="https://scratch.mit.edu/credits">Scratch contributors</a> but is not endorsed by Scratch in any way.
            </p>
            <p>
                <a href="https://scratch.mit.edu/donate">
                    Donate to support Scratch.
                </a>
            </p>
        </section>
        <section>
            <h2>Upstream TurboWarp contributors</h2>
            <UserList users={UserData.contributors} />
        </section>
        <section>
            <h2>Addons</h2>
            <p>
                Includes adapted work from <a href="https://scratchaddons.com/">Scratch Addons</a> and
                TurboWarp&apos;s bundled addons, alongside local experiments.
            </p>
            <UserList users={UserData.addonDevelopers} />
        </section>
        <section>
            <h2>TurboWarp Extension Gallery</h2>
            <UserList users={UserData.extensionDevelopers} />
        </section>
        <section>
            <h2>Documentation</h2>
            <UserList users={UserData.docs} />
        </section>
        <section>
            <h2>Translators</h2>
            <p>
                More than 100 people have helped translate TurboWarp and its addons into many languages
                &mdash; far more than we could hope to list here.
                New Griffpatch Studio preview text currently falls back to English.
            </p>
        </section>
        <section>
            <p>
                <i>
                    Individual contributors are listed in no particular order.
                    The order is randomized each visit.
                </i>
            </p>
        </section>
    </main>
);

render(<Credits />);
